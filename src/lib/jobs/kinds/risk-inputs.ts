import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAdjustedPriceHistory } from '@/lib/services/price-history'
import { alignCommonHistory, type CommonHistory } from '@/lib/services/common-history'
import { detectCadence, type Cadence } from '@/lib/services/asset-metrics'
import { getPortfolioBenchmark, BENCHMARKS } from '@/lib/services/benchmarks'
import { getRiskFreeRate, type RiskFreeRate } from '@/lib/services/risk-free-rate'
import {
  buildResultMetadata,
  combinePriceSources,
  COMMON_ASSUMPTIONS,
  type ResultAssumption,
  type ResultMetadata,
  type ResultModel,
} from '@/lib/services/result-metadata'
import type { HistorySource } from '@/lib/services/price-history'
import { loadFactorReturns } from '@/lib/jobs/kinds/factors'
import { alignRiskInputs, MIN_RISK_OBSERVATIONS, realSector, sectorLabel, type AlignedRiskInputs } from '@/lib/services/risk-sources'
import { TRADING_DAYS_PER_YEAR as TRADING_DAYS } from '@/lib/constants/financial-constants'


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
  riskFree: RiskFreeRate
  excludedSymbols: string[]
  /** Tier each market read came from, for the result metadata (P2-10). */
  sources: { prices: HistorySource; benchmark: HistorySource | null; factors: 'stored' | 'built' | null }
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
  const { rows: history, source: priceSource } = await fetchAdjustedPriceHistory(supabase, symbols, { limit: undefined })

  const common = alignCommonHistory(positions, history, { minObservations: MIN_RISK_OBSERVATIONS })
  if ('message' in common) return { message: common.message }
  if (!common.currentWeights) return { message: 'El portafolio no tiene valor a los precios disponibles.' }

  const { data: companies } = await supabase.from('company_data').select('symbol, sector, hq').in('symbol', common.symbols)
  const companySectors: Record<string, string | null> = {}
  const companyCountries: Record<string, string | null> = {}
  for (const company of companies ?? []) {
    // "ETF" in a sector field is an asset class, and grading it as a sector
    // would call a broad index fund a sector concentration.
    companySectors[company.symbol as string] = realSector(company.sector as string | null)
    companyCountries[company.symbol as string] = (company.hq as string | null) ?? null
  }
  const sectors: Record<string, string> = {}
  for (const position of positions) sectors[position.symbol] = sectorLabel(companySectors[position.symbol], position.asset_type)

  const benchmarkSymbol = await getPortfolioBenchmark(supabase, pid)
  const benchmarkName = BENCHMARKS.find((b) => b.symbol === benchmarkSymbol)?.name ?? benchmarkSymbol
  let benchmarkCloses: Map<string, number> | null = null
  let benchmarkSource: HistorySource | null = null
  try {
    const { rows, source } = await fetchAdjustedPriceHistory(supabase, [benchmarkSymbol], { limit: undefined })
    benchmarkSource = source
    const closes = new Map(rows.filter((r) => r.symbol === benchmarkSymbol).map((r) => [r.date, r.close]))
    benchmarkCloses = closes.size > 0 ? closes : null
  } catch {
    // Without the benchmark its views are left out; the rest still stands.
  }

  const riskFree = await getRiskFreeRate((portfolio as { currency?: string } | null)?.currency ?? 'USD')
  let factorGrid: { dates: string[]; factors: Array<{ id: string; name: string; returns: number[] }> } | null = null
  let factorSource: 'stored' | 'built' | null = null
  try {
    const loaded = await loadFactorReturns(supabase, riskFree.rate)
    if (loaded) {
      factorGrid = { dates: loaded.built.dates, factors: loaded.built.factors }
      factorSource = loaded.source
    }
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
    riskFree,
    excludedSymbols: symbols.filter((s) => !common.symbols.includes(s)),
    sources: { prices: priceSource, benchmark: benchmarkSource, factors: factorSource },
  }
}

/**
 * The metadata of a result computed from these inputs: the holdings' aligned
 * window, where each series came from, the benchmark and the risk-free rate.
 */
export function riskInputsMetadata(
  inputs: RiskInputs,
  model: ResultModel,
  options: { assumptions?: ResultAssumption[]; usesRiskFree?: boolean; usesBenchmark?: boolean } = {},
): ResultMetadata {
  const { common, aligned, cadence, sources } = inputs
  const factorNote = sources.factors ? `; series de factores ${sources.factors === 'stored' ? 'guardadas' : 'reconstruidas en esta consulta'}` : ''
  return buildResultMetadata({
    model,
    data: {
      description: `Precios de cierre diarios de ${common.symbols.length} posiciones en sus fechas comunes, pesos a los precios del ${common.lastDate}${aligned.benchmarkReturns ? ' e historial del benchmark' : ''}${factorNote}`,
      symbols: common.symbols,
      excluded: inputs.excludedSymbols,
      priceSource: combinePriceSources(sources.prices, aligned.benchmarkReturns ? sources.benchmark : null),
    },
    period: { from: common.commonDates[0], to: common.lastDate, observations: aligned.intervalsUsed, cadence: cadence.label },
    assumptions: [COMMON_ASSUMPTIONS.tradingDays, COMMON_ASSUMPTIONS.splitAdjusted, COMMON_ASSUMPTIONS.priceReturn, COMMON_ASSUMPTIONS.currentWeights, ...(options.assumptions ?? [])],
    benchmark: options.usesBenchmark === false || !aligned.benchmarkReturns ? null : inputs.benchmark,
    riskFreeRate: options.usesRiskFree ? inputs.riskFree : null,
  })
}
