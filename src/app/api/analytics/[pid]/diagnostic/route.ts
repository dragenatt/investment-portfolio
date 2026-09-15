import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { withCache } from '@/lib/cache/with-cache'
import { apiHandler } from '@/lib/api/handler'
import { loadRiskInputs } from '@/lib/jobs/kinds/risk-inputs'
import { analyseRiskSources } from '@/lib/services/risk-sources'
import { calculateCovarianceMatrix } from '@/lib/services/covariance'
import { loadBookTransactions, loadPriceMap, periodCutoff } from '@/lib/services/book-inputs'
import { reconstructBookHistory } from '@/lib/services/portfolio-history'
import { temporalAttribution } from '@/lib/services/temporal-attribution'
import { closeReturn, diagnosePortfolio } from '@/lib/services/portfolio-diagnostic'
import { getPortfolioBenchmark, BENCHMARKS } from '@/lib/services/benchmarks'

// Portfolio diagnostic (P2-8): nine questions answered from the risk sources,
// the temporal attribution and the drawdown episodes. Read-only by design.

/** The return window the performance questions look back over. */
const RETURN_PERIOD = '1Y'

async function getHandler(_req: Request, { params }: { params: Promise<{ pid: string }> }) {
  const { pid } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const data = await withCache(`analytics:diagnostic:${user.id}:${pid}`, 1800, async () => {
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
    const transactions = await loadBookTransactions(supabase, pid)
    let attribution = null
    let benchmarkReturnPct: number | null = null
    if (transactions.length > 0) {
      const cutoff = periodCutoff(RETURN_PERIOD)
      const symbols = [...new Set([...transactions.map((t) => t.symbol), benchmarkSymbol])]
      const prices = await loadPriceMap(supabase, symbols, cutoff, RETURN_PERIOD)
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
    }
  })

  return success(data)
}

export const GET = apiHandler(getHandler)
