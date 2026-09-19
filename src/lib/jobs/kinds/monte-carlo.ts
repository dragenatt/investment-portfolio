import type { SupabaseClient } from '@supabase/supabase-js'
import { calculateDailyReturns } from '@/lib/services/analytics'
import { simulatePortfolioGBM } from '@/lib/services/monte-carlo'
import { fetchAdjustedPriceHistory, type PriceRow } from '@/lib/services/price-history'
import { buildResultMetadata, COMMON_ASSUMPTIONS } from '@/lib/services/result-metadata'
import { TRADING_DAYS_PER_YEAR } from '@/lib/constants/financial-constants'
import { closesInBase, todaysSymbolFactors } from '@/lib/services/book-valuation'

/** One trading year of closes — the window the covariance matrix is estimated on. */
const LOOKBACK_DAYS = TRADING_DAYS_PER_YEAR

/** Minimum aligned observations before a covariance matrix is worth estimating. */
const MIN_OBSERVATIONS = 10

const SIMULATIONS = 1500


/**
 * Index history as symbol -> date -> close, keeping the last close seen for a
 * date (the same symbol can arrive from more than one exchange row).
 */
function indexBySymbol(history: PriceRow[]): Map<string, Map<string, number>> {
  const bySymbol = new Map<string, Map<string, number>>()
  for (const row of history) {
    if (row.close == null || !Number.isFinite(row.close) || row.close <= 0) continue
    let dates = bySymbol.get(row.symbol)
    if (!dates) {
      dates = new Map<string, number>()
      bySymbol.set(row.symbol, dates)
    }
    dates.set(row.date, row.close)
  }
  return bySymbol
}

/**
 * The latest LOOKBACK_DAYS dates every symbol traded on, ascending. The
 * covariance matrix is only meaningful when element t of each return series is
 * the same trading day, so symbols are intersected rather than padded.
 */
function alignedDates(bySymbol: Map<string, Map<string, number>>, symbols: string[]): string[] {
  if (symbols.length === 0) return []
  const first = bySymbol.get(symbols[0])
  if (!first) return []
  return [...first.keys()]
    .filter((date) => symbols.every((s) => bySymbol.get(s)?.has(date)))
    .sort((a, b) => a.localeCompare(b))
    .slice(-LOOKBACK_DAYS)
}

const round2 = (value: number) => Math.round(value * 100) / 100

export async function computeMonteCarlo(supabase: SupabaseClient, pid: string, params: { weeks: number }) {
  const { weeks } = params
  // Get portfolio positions
  const { data: positions } = await supabase
    .from('positions')
    .select('symbol, quantity, avg_cost')
    .eq('portfolio_id', pid)
    .gt('quantity', 0)

  if (!positions || positions.length === 0) {
    return { message: 'No positions' }
  }

  // Get price history — tries DB first, falls back to Yahoo Finance
  const symbols = positions.map(p => p.symbol)
  const { rows: quoted, source: priceSource } = await fetchAdjustedPriceHistory(supabase, symbols, { limit: Math.min(symbols.length * (LOOKBACK_DAYS + 60), 5000) })

  // The cone is money, so it has to be in one currency: each holding's closes
  // into the portfolio's, at today's rate. Summed as quoted, a dollar book was
  // drawn in dollars under the portfolio's peso label, and a mixed book added
  // pesos to dollars — its weights as wrong as its total.
  const { data: portfolio } = await supabase.from('portfolios').select('base_currency').eq('id', pid).maybeSingle()
  const fx = await todaysSymbolFactors(supabase, symbols, String(portfolio?.base_currency ?? 'USD'))
  const history = closesInBase(quoted, fx.factors)

  if (history.length < MIN_OBSERVATIONS) {
    return { message: 'No positions' }
  }

  const bySymbol = indexBySymbol(history)
  const covered = symbols.filter(s => bySymbol.has(s))
  const dates = alignedDates(bySymbol, covered)

  if (covered.length === 0 || dates.length < MIN_OBSERVATIONS) {
    return { message: 'Not enough price history' }
  }

  // Weight each asset by what it is worth at the latest common close, so the
  // simulated cone starts from the book as it stands today.
  const lastDate = dates[dates.length - 1]
  const marketValues = covered.map((symbol) => {
    const position = positions.find(p => p.symbol === symbol)
    const close = bySymbol.get(symbol)?.get(lastDate) ?? 0
    return (position?.quantity ?? 0) * close
  })
  const currentValue = marketValues.reduce((a, b) => a + b, 0)

  if (currentValue <= 0) {
    return { message: 'No positions' }
  }

  const assets = covered.map((symbol, i) => ({
    symbol,
    weight: marketValues[i] / currentValue,
    historicalReturns: calculateDailyReturns(
      dates.map(date => bySymbol.get(symbol)!.get(date)!)
    ),
  }))

  const simulation = simulatePortfolioGBM({
    assets,
    weeks,
    numSimulations: SIMULATIONS,
  })

  // The engine works on a portfolio normalised to 1.0 — scale it into money.
  const bands = simulation.weeklyBands.map(band => ({
    week: band.week,
    p10: round2(band.p10 * currentValue),
    p50: round2(band.p50 * currentValue),
    p90: round2(band.p90 * currentValue),
  }))

  return {
    /** The currency every amount below is in: the portfolio's. */
    currency: fx.base,
    unconverted: fx.unconverted.filter((s) => covered.includes(s)),
    current_value: round2(currentValue),
    weeks,
    simulations: SIMULATIONS,
    bands,
    expected_value: bands.length > 0 ? bands[bands.length - 1].p50 : round2(currentValue),
    var_95: {
      pct: round2(simulation.var95 * 100),
      amount: round2(simulation.var95 * currentValue),
    },
    assets: assets.map(a => ({
      symbol: a.symbol,
      weight: round2(a.weight * 100),
    })),
    lookback_days: dates.length,
    dataPoints: dates.length,
    _meta: buildResultMetadata({
      model: 'monteCarlo',
      data: { description: 'Rendimientos diarios de las posiciones en sus fechas comunes, pesos al último cierre común', symbols: covered, excluded: symbols.filter((s) => !covered.includes(s)), priceSource },
      period: { from: dates[0], to: lastDate, observations: dates.length - 1, cadence: '1 dia' },
      assumptions: [
        COMMON_ASSUMPTIONS.tradingDays,
        COMMON_ASSUMPTIONS.splitAdjusted,
        COMMON_ASSUMPTIONS.baseCurrencyToday(fx.base),
        { name: 'Proceso', value: 'Movimiento browniano geométrico correlacionado, pasos semanales, comprar y mantener', source: 'monte-carlo.ts' },
        { name: 'Ventana de estimación', value: `Hasta ${LOOKBACK_DAYS} días`, source: 'docs/FINANCIAL_ASSUMPTIONS.md (Covariance window)' },
        { name: 'Trayectorias', value: `${SIMULATIONS}, semilla fija`, source: 'monte-carlo.ts' },
      ],
    }),
  }
}
