import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { withAuditedCache } from '@/lib/cache/with-cache'
import { apiHandler } from '@/lib/api/handler'
import { loadRiskInputs, riskInputsMetadata } from '@/lib/jobs/kinds/risk-inputs'
import { analyseRiskSources } from '@/lib/services/risk-sources'
import { averageDailyVolumes, computePortfolioHealth } from '@/lib/services/portfolio-health'

// Portfolio Health (P2-7): an educational grade of how the portfolio is built,
// from the same inputs as the risk sources. See src/lib/services/portfolio-health.ts.

/** Recent sessions averaged for daily volume. */
const VOLUME_SESSIONS = 20

async function getHandler(_req: Request, { params }: { params: Promise<{ pid: string }> }) {
  const { pid } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const data = await withAuditedCache(`analytics:health:${user.id}:${pid}`, 1800, async () => {
    const inputs = await loadRiskInputs(supabase, pid)
    if ('message' in inputs) return { message: inputs.message }
    const { common, aligned, cadence, sectors, benchmark, positions } = inputs

    const riskSources = analyseRiskSources({
      symbols: common.symbols,
      weights: common.currentWeights,
      returnsMatrix: aligned.returnsMatrix,
      periodsPerYear: cadence.periodsPerYear,
      sectors,
      benchmark: aligned.benchmarkReturns ? { ...benchmark, returns: aligned.benchmarkReturns } : null,
      factors: aligned.factors,
    })
    if (!riskSources) return { message: 'No hay suficiente historial en común para calcular la salud del portafolio.' }

    const { data: volumeRows } = await supabase
      .from('price_history')
      .select('symbol, date, volume')
      .in('symbol', common.symbols)
      .order('date', { ascending: false })
      .limit(common.symbols.length * (VOLUME_SESSIONS + 10))
    const volumes = averageDailyVolumes((volumeRows ?? []) as Array<{ symbol: string; date: string; volume: number | null }>, VOLUME_SESSIONS)

    const bySymbol = new Map(positions.map((p) => [p.symbol, p]))
    const health = computePortfolioHealth({
      holdings: common.symbols.map((symbol, i) => ({
        symbol,
        weight: common.currentWeights[i],
        quantity: bySymbol.get(symbol)?.quantity ?? 0,
        assetType: bySymbol.get(symbol)?.asset_type ?? null,
        companySector: inputs.companySectors[symbol] ?? null,
        currency: bySymbol.get(symbol)?.currency ?? null,
        country: inputs.companyCountries[symbol] ?? null,
        averageDailyVolume: volumes[symbol] ?? null,
      })),
      returnsMatrix: aligned.returnsMatrix,
      benchmarkReturns: aligned.benchmarkReturns,
      benchmarkName: benchmark.name,
      periodsPerYear: cadence.periodsPerYear,
      riskSources,
    })
    if (!health) return { message: 'No se pudo calcular la salud del portafolio con estos datos.' }

    return {
      ...health,
      window: { from: common.commonDates[0], to: common.lastDate, intervals_used: aligned.intervalsUsed, cadence: cadence.label },
      excluded_symbols: inputs.excludedSymbols,
      benchmark,
      _meta: riskInputsMetadata(inputs, 'portfolioHealth', {
        assumptions: [
          { name: 'Umbrales de cada componente', value: 'Ver la tabla "Portfolio Health (P2-7)"', source: 'docs/FINANCIAL_ASSUMPTIONS.md' },
          { name: 'Volumen diario', value: `Promedio de las últimas ${VOLUME_SESSIONS} sesiones guardadas`, source: 'price_history' },
        ],
      }),
    }
  })

  return success(data)
}

export const GET = apiHandler(getHandler)
