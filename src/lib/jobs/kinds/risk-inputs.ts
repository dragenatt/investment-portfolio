import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAdjustedPriceHistory } from '@/lib/services/price-history'
import { alignCommonHistory, type CommonHistory } from '@/lib/services/common-history'
import { detectCadence, type Cadence } from '@/lib/services/asset-metrics'
import { getPortfolioBenchmark, BENCHMARKS } from '@/lib/services/benchmarks'
import { getRiskFreeRate } from '@/lib/services/risk-free-rate'
import { loadFactorReturns } from '@/lib/jobs/kinds/factors'
import { alignRiskInputs, MIN_RISK_OBSERVATIONS, sectorLabel, type AlignedRiskInputs } from '@/lib/services/risk-sources'

const TRADING_DAYS = 252

export type RiskInputPosition = {
  symbol: string
  quantity: number
  asset_type: string | null
  currency: string | null
}

export type RiskInputs = {
  positions: RiskInputPosition[]
  common: CommonHistory & { currentWeights: number[] }
  aligned: AlignedRiskInputs
  cadence: Cadence
  /** Sector per symbol as grouped: the company sector, else the asset type. */
  sectors: Record<string, string>
  /** Only the sectors that come from company data; null where there is none. */
  companySectors: Record<string, string | null>
  /** Company headquarters country where known. */
  companyCountries: Record<string, string | null>
  benchmark: { symbol: string; name: string }
  riskFreeRate: number
  excludedSymbols: string[]
}

/**
 * Everything the risk sources (P2-5) and the health score (P2-7) are computed
 * from: the holdings on their common dates, the benchmark and factor series on
 * exactly those intervals, sectors and the cadence. One loader, so both read
 * the same window and the health score grades the very numbers the risk card
 * shows.
 */
export async function loadRiskInputs(supabase: SupabaseClient, pid: string): Promise<RiskInputs | { message: string }> {
  const { data: portfolio } = await supabase.from('portfolios').select('currency:base_currency').eq('id', pid).single()

  // RLS decides what this user may read: another user's private portfolio
  // simply has no positions here.
  const { data: rawPositions } = await supabase
    .from('positions')
    .select('symbol, quantity, asset_type, currency')
    .eq('portfolio_id', pid)
    .gt('quantity', 0)

  const positions = (rawPositions ?? []) as RiskInputPosition[]
  if (positions.length === 0) return { message: 'No hay posiciones.' }

  const symbols = positions.map((p) => p.symbol)
  const { rows: history } = await fetchAdjustedPriceHistory(supabase, symbols, { limit: undefined })

  const common = alignCommonHistory(positions, history, { minObservations: MIN_RISK_OBSERVATIONS })
  if ('message' in common) return { message: common.message }
  if (!common.currentWeights) return { message: 'El portafolio no tiene valor a los precios disponibles.' }

  const { data: companies } = await supabase.from('company_data').select('symbol, sector, hq').in('symbol', common.symbols)
  const companySectors: Record<string, string | null> = {}
  const companyCountries: Record<string, string | null> = {}
  for (const company of companies ?? []) {
    companySectors[company.symbol as string] = (company.sector as string | null) ?? null
    companyCountries[company.symbol as string] = (company.hq as string | null) ?? null
  }
  const sectors: Record<string, string> = {}
  for (const position of positions) sectors[position.symbol] = sectorLabel(companySectors[position.symbol], position.asset_type)

  const benchmarkSymbol = await getPortfolioBenchmark(supabase, pid)
  const benchmarkName = BENCHMARKS.find((b) => b.symbol === benchmarkSymbol)?.name ?? benchmarkSymbol
  let benchmarkCloses: Map<string, number> | null = null
  try {
    const { rows } = await fetchAdjustedPriceHistory(supabase, [benchmarkSymbol], { limit: undefined })
    const closes = new Map(rows.filter((r) => r.symbol === benchmarkSymbol).map((r) => [r.date, r.close]))
    benchmarkCloses = closes.size > 0 ? closes : null
  } catch {
    // Without the benchmark its views are left out; the rest still stands.
  }

  const riskFree = await getRiskFreeRate((portfolio as { currency?: string } | null)?.currency ?? 'USD')
  let factorGrid: { dates: string[]; factors: Array<{ id: string; name: string; returns: number[] }> } | null = null
  try {
    const loaded = await loadFactorReturns(supabase, riskFree.rate)
    if (loaded) factorGrid = { dates: loaded.built.dates, factors: loaded.built.factors }
  } catch {
    // Same: no factors, no factor view.
  }

  const aligned = alignRiskInputs({ dates: common.commonDates, returnsMatrix: common.returnsMatrix, benchmarkCloses, factorGrid })

  const cadence = detectCadence(common.commonDates.map((date) => ({ date, close: 1 }))) ?? {
    daysPerBar: 1,
    periodsPerYear: TRADING_DAYS,
    label: '1 dia',
  }

  return {
    positions,
    common: { ...common, currentWeights: common.currentWeights },
    aligned,
    cadence,
    sectors,
    companySectors,
    companyCountries,
    benchmark: { symbol: benchmarkSymbol, name: benchmarkName },
    riskFreeRate: riskFree.rate,
    excludedSymbols: symbols.filter((s) => !common.symbols.includes(s)),
  }
}
