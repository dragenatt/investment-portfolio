import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { withCache } from '@/lib/cache/with-cache'
import { apiHandler } from '@/lib/api/handler'
import { fetchAdjustedPriceHistory } from '@/lib/services/price-history'
import { alignCommonHistory } from '@/lib/services/common-history'
import { detectCadence } from '@/lib/services/asset-metrics'
import { getPortfolioBenchmark, BENCHMARKS } from '@/lib/services/benchmarks'
import { getRiskFreeRate } from '@/lib/services/risk-free-rate'
import { loadFactorReturns } from '@/lib/jobs/kinds/factors'
import { alignRiskInputs, analyseRiskSources, MIN_RISK_OBSERVATIONS, sectorLabel } from '@/lib/services/risk-sources'

// The true sources of the portfolio's risk (P2-5): by holding, sector, factor,
// principal component and market, every view decomposing the same variance on
// the same aligned window. See src/lib/services/risk-sources.ts.

const TRADING_DAYS = 252

async function getHandler(_req: Request, { params }: { params: Promise<{ pid: string }> }) {
  const { pid } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const data = await withCache(`analytics:risk-sources:${user.id}:${pid}`, 1800, async () => {
    const { data: portfolio } = await supabase
      .from('portfolios')
      .select('currency:base_currency')
      .eq('id', pid)
      .single()

    // RLS decides what this user may read: another user's private portfolio
    // simply has no positions here.
    const { data: positions } = await supabase
      .from('positions')
      .select('symbol, quantity, asset_type')
      .eq('portfolio_id', pid)
      .gt('quantity', 0)

    if (!positions || positions.length === 0) return { message: 'No hay posiciones.' }

    const symbols = positions.map((p) => p.symbol)
    const { rows: history } = await fetchAdjustedPriceHistory(supabase, symbols, { limit: undefined })

    const common = alignCommonHistory(positions, history, { minObservations: MIN_RISK_OBSERVATIONS })
    if ('message' in common) return { message: common.message }
    if (!common.currentWeights) return { message: 'El portafolio no tiene valor a los precios disponibles.' }

    // Sector per holding: the company data where there is one, the asset type
    // otherwise, so an index is "Índices" rather than unclassified.
    const { data: companies } = await supabase.from('company_data').select('symbol, sector').in('symbol', common.symbols)
    const companySector = new Map((companies ?? []).map((c) => [c.symbol as string, c.sector as string | null]))
    const sectors: Record<string, string> = {}
    for (const position of positions) {
      sectors[position.symbol] = sectorLabel(companySector.get(position.symbol), position.asset_type as string | null)
    }

    const benchmarkSymbol = await getPortfolioBenchmark(supabase, pid)
    const benchmarkName = BENCHMARKS.find((b) => b.symbol === benchmarkSymbol)?.name ?? benchmarkSymbol
    let benchmarkCloses: Map<string, number> | null = null
    try {
      const { rows } = await fetchAdjustedPriceHistory(supabase, [benchmarkSymbol], { limit: undefined })
      const closes = new Map(rows.filter((r) => r.symbol === benchmarkSymbol).map((r) => [r.date, r.close]))
      benchmarkCloses = closes.size > 0 ? closes : null
    } catch {
      // Without the benchmark the market view is left out; the rest still stands.
    }

    const riskFree = await getRiskFreeRate(portfolio?.currency ?? 'USD')
    let factorGrid: { dates: string[]; factors: Array<{ id: string; name: string; returns: number[] }> } | null = null
    try {
      const loaded = await loadFactorReturns(supabase, riskFree.rate)
      if (loaded) factorGrid = { dates: loaded.built.dates, factors: loaded.built.factors }
    } catch {
      // Same: no factors, no factor view.
    }

    const aligned = alignRiskInputs({
      dates: common.commonDates,
      returnsMatrix: common.returnsMatrix,
      benchmarkCloses,
      factorGrid,
    })

    const cadence = detectCadence(common.commonDates.map((date) => ({ date, close: 1 }))) ?? {
      daysPerBar: 1,
      periodsPerYear: TRADING_DAYS,
      label: '1 dia',
    }

    const sources = analyseRiskSources({
      symbols: common.symbols,
      weights: common.currentWeights,
      returnsMatrix: aligned.returnsMatrix,
      periodsPerYear: cadence.periodsPerYear,
      sectors,
      benchmark: aligned.benchmarkReturns ? { symbol: benchmarkSymbol, name: benchmarkName, returns: aligned.benchmarkReturns } : null,
      factors: aligned.factors,
    })

    if (!sources) {
      return { message: `No hay suficiente historial en común para medir las fuentes de riesgo (se necesitan ${MIN_RISK_OBSERVATIONS} periodos).` }
    }

    return {
      ...sources,
      window: {
        from: common.commonDates[0],
        to: common.lastDate,
        intervals_used: aligned.intervalsUsed,
        intervals_available: aligned.intervalsAvailable,
        cadence: cadence.label,
      },
      excluded_symbols: symbols.filter((s) => !common.symbols.includes(s)),
      omitted: aligned.omitted,
      benchmark: { symbol: benchmarkSymbol, name: benchmarkName },
    }
  })

  return success(data)
}

export const GET = apiHandler(getHandler)
