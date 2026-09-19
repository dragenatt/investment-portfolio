import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { withAuditedCache } from '@/lib/cache/with-cache'
import { apiHandler } from '@/lib/api/handler'
import { loadRiskInputs, riskInputsMetadata } from '@/lib/jobs/kinds/risk-inputs'
import { analyseRiskSources } from '@/lib/services/risk-sources'
import { calculateCovarianceMatrix } from '@/lib/services/covariance'
import { bookInputsInBase, loadBookTransactions, periodCutoff } from '@/lib/services/book-inputs'
import { reconstructBookHistory } from '@/lib/services/portfolio-history'
import { temporalAttribution } from '@/lib/services/temporal-attribution'
import { closeReturn, diagnosePortfolio } from '@/lib/services/portfolio-diagnostic'
import { getPortfolioBenchmark, BENCHMARKS } from '@/lib/services/benchmarks'
import { buildResultMetadata, COMMON_ASSUMPTIONS } from '@/lib/services/result-metadata'

// Portfolio diagnostic (P2-8): nine questions answered from the risk sources,
// the temporal attribution and the drawdown episodes. Read-only by design.

/** The return window the performance questions look back over. */
const RETURN_PERIOD = '1Y'

async function getHandler(_req: Request, { params }: { params: Promise<{ pid: string }> }) {
  const { pid } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const data = await withAuditedCache(`analytics:diagnostic:v2:${user.id}:${pid}`, 1800, async () => {
    // Risk side: the same inputs as the risk sources and the health score.
    const inputs = await loadRiskInputs(supabase, pid)
    let riskSources = null
    let holdings = null
    let cov = null
    let growth = null
    let windowStart = null
    if (!('message' in inputs)) {
      const { common, aligned, cadence, sectors, benchmark } = inputs
      riskSources = analyseRiskSources({
        symbols: common.symbols,
        weights: common.currentWeights,
        returnsMatrix: aligned.returnsMatrix,
        periodsPerYear: cadence.periodsPerYear,
        sectors,
        benchmark: aligned.benchmarkReturns ? { ...benchmark, returns: aligned.benchmarkReturns } : null,
        factors: aligned.factors,
      })
      holdings = common.symbols.map((symbol, i) => ({
        symbol,
        weight: common.currentWeights[i],
        companySector: inputs.companySectors[symbol] ?? null,
      }))
      cov = calculateCovarianceMatrix(aligned.returnsMatrix).map((row) => row.map((v) => v * cadence.periodsPerYear))
      growth = common.returnsMatrix.map((series) => series.reduce((g, r) => g * (1 + r), 1))
      windowStart = common.commonDates[0]
    }

    // Return side: the book rebuilt from its transactions, as the returns tab does.
    const benchmarkSymbol = 'message' in inputs ? await getPortfolioBenchmark(supabase, pid) : inputs.benchmark.symbol
    const benchmarkName = BENCHMARKS.find((b) => b.symbol === benchmarkSymbol)?.name ?? benchmarkSymbol
    const recorded = await loadBookTransactions(supabase, pid)
    let attribution = null
    let benchmarkReturnPct: number | null = null
    if (recorded.length > 0) {
      const cutoff = periodCutoff(RETURN_PERIOD)
      const symbols = [...new Set([...recorded.map((t) => t.symbol), benchmarkSymbol])]
      // In the portfolio's currency, the benchmark too, so "did it beat the
      // benchmark" compares two returns in one currency (bookInputsInBase).
      const { transactions, prices } = await bookInputsInBase(supabase, pid, recorded, symbols, cutoff, RETURN_PERIOD)
      attribution = temporalAttribution(reconstructBookHistory(transactions, prices, { from: cutoff }), 'day')
      if (attribution.total) {
        benchmarkReturnPct = closeReturn(prices[benchmarkSymbol] ?? {}, attribution.total.start, attribution.total.end)
      }
    }

    const diagnostic = diagnosePortfolio({
      riskSources,
      holdings,
      cov,
      growth,
      windowStart,
      attribution,
      benchmark: { name: benchmarkName, returnPct: benchmarkReturnPct },
    })

    return {
      ...diagnostic,
      risk_window: 'message' in inputs ? null : { from: inputs.common.commonDates[0], to: inputs.common.lastDate },
      return_window: attribution?.total ? { from: attribution.total.start, to: attribution.total.end } : null,
      benchmark: { symbol: benchmarkSymbol, name: benchmarkName },
      _meta: (() => {
        const assumptions = [
          { name: 'Rendimientos', value: `Ponderados por tiempo, últimos ${RETURN_PERIOD}, reconstruidos de las operaciones, en la moneda del portafolio (el benchmark también)`, source: 'temporal-attribution.ts' },
          { name: 'Sobreexposición sectorial', value: 'Más de 35% del portafolio', source: 'exposure.ts' },
          { name: 'Sensibilidad de riesgo', value: '5 puntos entre el peso que más y el que menos mueve la volatilidad', source: 'Convención (portfolio-diagnostic.ts)' },
        ]
        if (!('message' in inputs)) {
          const meta = riskInputsMetadata(inputs, 'diagnostic', { assumptions })
          return attribution?.total
            ? { ...meta, period: { ...meta.period, from: [meta.period.from, attribution.total.start].sort()[0], to: meta.period.to } }
            : meta
        }
        return buildResultMetadata({
          model: 'diagnostic',
          data: { description: 'Operaciones del portafolio y cierres diarios del último año', symbols: [...new Set(recorded.map((t) => t.symbol))], priceSource: 'stored' },
          period: attribution?.total ? { from: attribution.total.start, to: attribution.total.end } : {},
          assumptions: [COMMON_ASSUMPTIONS.priceReturn, ...assumptions],
          benchmark: { symbol: benchmarkSymbol, name: benchmarkName },
        })
      })(),
    }
  })

  return success(data)
}

export const GET = apiHandler(getHandler)
