import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAdjustedPriceHistory, type PriceRow } from '@/lib/services/price-history'
import { calculateDailyReturns } from '@/lib/services/analytics'
import { getRiskFreeRate } from '@/lib/services/risk-free-rate'
import {
  FACTOR_DEFINITIONS,
  buildFactorReturns,
  runFactorRegression,
  describeFactorExposure,
  type BuiltFactorReturns,
  type FactorBar,
} from '@/lib/services/factors'
import { factorRebuildDue, loadStoredFactorReturns, storeFactorReturns } from '@/lib/services/factor-store'
import { portfolioValueSeries } from '@/lib/services/portfolio-series'

/** Fewer aligned days than this and the loadings are noise with error bars. */
const MIN_REGRESSION_DAYS = 60

/** How far back the stored tier is asked for. */
const LOOKBACK_DAYS = 400

/** When this instance last tried to rebuild the factor series. */
let lastRebuildAttempt: number | null = null

/**
 * The factor return series: the stored tier first, built from the ETF histories
 * and written through when it is missing. Shared by the factor regression and
 * the risk sources (P2-5), so both regress on the same series.
 */
export async function loadFactorReturns(
  supabase: SupabaseClient,
  riskFreeRate: number,
): Promise<{ built: BuiltFactorReturns; source: 'stored' | 'built' } | null> {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10)

  // Stored tier first, exactly as price_history does. Building costs seven
  // ETF histories; reading costs one query — unless the stored series is stale
  // or incomplete (see factorRebuildDue).
  const stored = await loadStoredFactorReturns(supabase, since)
  if (!factorRebuildDue(stored, lastRebuildAttempt)) return { built: stored!, source: 'stored' }
  lastRebuildAttempt = Date.now()

  const factorSymbols = [...new Set(FACTOR_DEFINITIONS.flatMap((f) => f.symbols))]
  const { rows: factorRows } = await fetchAdjustedPriceHistory(supabase, factorSymbols, {
    limit: undefined,
  })

  const prices = new Map<string, FactorBar[]>()
  for (const row of factorRows as PriceRow[]) {
    const bars = prices.get(row.symbol) ?? []
    bars.push({ date: row.date, close: row.close })
    prices.set(row.symbol, bars)
  }

  const built = buildFactorReturns(prices, riskFreeRate)
  // A rebuild that came out worse — fewer factors, or none — does not replace
  // what is stored; the stored series is served until the next attempt.
  if (!built || (stored && built.factors.length < stored.factors.length)) {
    return stored ? { built: stored, source: 'stored' } : null
  }
  // Write-through. A failed write is not a failed request: the answer is
  // already in hand and the next call simply rebuilds.
  await storeFactorReturns(built)
  return { built, source: 'built' }
}

/**
 * Which known risks this portfolio is actually taking.
 *
 * A beta against the market says how much of the movement the market explains.
 * It cannot say why the rest moves. This splits that remainder into named tilts
 * — size, value, momentum, quality, low volatility — and, more usefully, says
 * which of them are large enough to be distinguishable from coincidence.
 *
 * The uncomfortable half is the point: an alpha measured against the market
 * alone usually shrinks toward zero once these tilts are accounted for, because
 * what looked like selection was a tilt that could have been bought cheaply.
 */
export async function computeFactors(supabase: SupabaseClient, pid: string, _params: Record<string, never>) {
  const { data: portfolio } = await supabase
    .from('portfolios')
    .select('currency:base_currency')
    .eq('id', pid)
    .single()

  const { data: positions } = await supabase
    .from('positions')
    .select('symbol, quantity')
    .eq('portfolio_id', pid)
    .gt('quantity', 0)

  if (!positions || positions.length === 0) return { message: 'No positions' }

  const symbols = positions.map((p) => p.symbol)
  const { rows: history } = await fetchAdjustedPriceHistory(supabase, symbols, {
    limit: undefined,
  })
  if (history.length < MIN_REGRESSION_DAYS) {
    return { message: 'No hay suficiente historial para una regresion de factores.' }
  }

  // Same construction the risk endpoint uses, so the two agree on what "the
  // portfolio" means — including skipping dates where a holding is unpriced.
  const series = portfolioValueSeries(history, positions)
  if (!series) {
    return { message: 'No hay suficiente historial para una regresion de factores.' }
  }

  const portfolioDates = series.dates
  const portfolioReturns = calculateDailyReturns(series.values)
  // calculateDailyReturns drops the first bar, so returns line up with dates[1..]
  const returnByDate = new Map<string, number>()
  for (let i = 0; i < portfolioReturns.length; i++) {
    returnByDate.set(portfolioDates[i + 1], portfolioReturns[i])
  }

  const riskFree = await getRiskFreeRate(portfolio?.currency ?? 'USD')

  const loaded = await loadFactorReturns(supabase, riskFree.rate)
  const built = loaded?.built ?? null
  const source = loaded?.source ?? 'built'

  if (!built) {
    return {
      message:
        'No se pudieron construir las series de factores: falta historial de los ETF que las componen.',
    }
  }

  // Align the portfolio against the factor grid. Regressing on dates the
  // portfolio did not trade would attribute movement to days it had none.
  const aligned = built.dates
    .map((date, i) => ({ date, index: i, own: returnByDate.get(date) }))
    .filter((row): row is { date: string; index: number; own: number } =>
      row.own !== undefined,
    )

  if (aligned.length < MIN_REGRESSION_DAYS) {
    return {
      message: `Se necesitan al menos ${MIN_REGRESSION_DAYS} dias en comun entre tu cartera y las series de factores; hay ${aligned.length}.`,
    }
  }

  const regression = runFactorRegression(
    aligned.map((row) => row.own),
    built.factors.map((factor) => ({
      name: factor.name,
      returns: aligned.map((row) => factor.returns[row.index]),
    })),
  )

  if (!regression) {
    return {
      message:
        'La regresion no tiene solucion unica con estos datos, normalmente porque dos factores se mueven casi identico en el periodo disponible.',
    }
  }

  return {
    source,
    from_date: aligned[0].date,
    to_date: aligned[aligned.length - 1].date,
    risk_free_rate: {
      currency: riskFree.currency,
      annual_pct: Math.round(riskFree.rate * 10000) / 100,
      source: riskFree.source,
      is_fallback: riskFree.isFallback,
    },
    regression,
    summary: describeFactorExposure(regression),
    // The definitions travel with the numbers. A loading of 0.3 on "value"
    // means nothing to a reader who does not know what the series is.
    definitions: FACTOR_DEFINITIONS.filter((definition) =>
      built!.factors.some((f) => f.id === definition.id),
    ),
    omitted: built.omitted,
  }
}
