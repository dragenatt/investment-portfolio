/**
 * Portfolio Snapshot Engine
 *
 * Computes comprehensive portfolio metrics and stores them as daily snapshots.
 * Designed to run nightly via Vercel Cron or on-demand.
 *
 * Metrics computed:
 * - Total value, cost, return, return %
 * - Position count, allocation breakdown, top holdings
 * - Risk score, Sharpe ratio, volatility, max drawdown
 * - Beta, alpha, Sortino ratio, win rate
 * - Diversification score (HHI)
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { serviceRoleClient } from '@/lib/supabase/admin'
import { getBenchmarkSeries, getPortfolioBenchmark } from './benchmarks'
import { calculateBetaAlpha, calculateDailyReturns, calculateSharpeRatio, type BetaAlpha } from './analytics'
import { calculateSortinoRatio } from './asset-metrics'
import { getRiskFreeRate } from './risk-free-rate'
import { getBatchQuotes } from './market'
import { publishQuotes } from './quote-store'
import {
  buildLeaderboards,
  LEADERBOARD_CATEGORIES,
  LEADERBOARD_PERIOD,
  type LeaderboardProfile,
  type LeaderboardSnapshot,
} from './discover'
import { TRADING_DAYS_PER_YEAR } from '@/lib/constants/financial-constants'
import { valueBookInBase } from './book-valuation'

// ─── Types ──────────────────────────────────────────────────────────────────

type Position = {
  id: string
  symbol: string
  asset_type: string
  quantity: number
  avg_cost: number
  currency: string
}

type HistoricalSnapshot = {
  snapshot_date: string
  total_value: number
  total_return_pct: number
}

type SnapshotResult = {
  portfolio_id: string
  snapshot_date: string
  total_value: number
  total_cost: number
  total_return: number
  total_return_pct: number
  position_count: number
  allocation: Record<string, number>
  top_holdings: Array<{ symbol: string; weight: number; value: number }>
  risk_score: number | null
  sharpe_ratio: number | null
  volatility: number | null
  max_drawdown: number | null
  beta: number | null
  alpha: number | null
  sortino_ratio: number | null
  win_rate: number | null
  diversification_score: number | null
  currency: string
  valuation_version: number
}

// ─── Constants ──────────────────────────────────────────────────────────────

/**
 * Snapshots at this version or above value the book in the portfolio's base
 * currency. Earlier rows summed each symbol's quote currency and each
 * position's cost currency as one unit (migration 024) and every reader skips
 * them: one of them next to a converted row reads as a seventeen-fold jump.
 */
export const SNAPSHOT_VALUATION_VERSION = 2


// ─── Supabase Admin Client ──────────────────────────────────────────────────

/** The service-role client, required: crons and jobs cannot run without it. */
export function createAdminSupabase(): SupabaseClient {
  const client = serviceRoleClient()
  if (!client) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured')
  return client
}

// ─── Cron Monitoring ────────────────────────────────────────────────────────

export async function startCronRun(
  supabase: SupabaseClient,
  jobName: string
): Promise<string> {
  const { data } = await supabase
    .from('cron_runs')
    .insert({ job_name: jobName, status: 'running' })
    .select('id')
    .single()
  return data?.id ?? ''
}

export async function finishCronRun(
  supabase: SupabaseClient,
  runId: string,
  result: { processed: number; errors: number; errorDetails?: unknown }
): Promise<void> {
  if (!runId) return
  const status = result.errors === 0 ? 'success' : result.processed > 0 ? 'partial' : 'failed'
  // No duration here: the routes write it once they have measured it. This used
  // to send Date.now() as a placeholder, which overflows the integer column, so
  // Postgres rejected the whole update and every run stayed 'running' forever.
  const { error } = await supabase
    .from('cron_runs')
    .update({
      status,
      finished_at: new Date().toISOString(),
      portfolios_processed: result.processed,
      portfolios_failed: result.errors,
      error_details: result.errorDetails ?? null,
    })
    .eq('id', runId)
  if (error) console.error('[cron] could not record the end of the run', runId, error.message)
}

// ─── Price Fetching ─────────────────────────────────────────────────────────

/**
 * Closing prices for the snapshot, through the same provider chain as every
 * screen — Twelve Data, Finnhub, then Yahoo. This used to call Twelve Data and
 * Finnhub directly and stop there, so without those keys every position was
 * valued at its average cost and the snapshot recorded no market movement.
 * `fresh` skips the five-minute price cache: a snapshot is the day's record.
 *
 * What comes back is also published to current_prices (quote-store.ts). This
 * job is the only thing that reads a quote for every held symbol every night;
 * keeping the numbers and discarding the quotes left the stored price of any
 * holding nobody had on screen as old as the last time someone looked at it,
 * and that stored price is what the analytics routes value books with.
 */
async function fetchCurrentPrices(
  symbols: string[],
  writer?: SupabaseClient,
): Promise<Record<string, number>> {
  const prices: Record<string, number> = {}

  if (symbols.length === 0) return prices

  try {
    const quotes = await getBatchQuotes(symbols, { fresh: true })
    for (const symbol of symbols) {
      const price = (quotes[symbol] ?? quotes[symbol.toUpperCase()])?.price
      if (price != null && price > 0) prices[symbol] = price
    }
    if (writer) await publishQuotes(writer, quotes)
  } catch (err) {
    // Unpriced positions fall back to their average cost below.
    console.warn('[snapshots] provider chain failed', err)
  }

  return prices
}

// ─── Statistical Helpers ────────────────────────────────────────────────────

function mean(arr: number[]): number {
  if (arr.length === 0) return 0
  return arr.reduce((sum, v) => sum + v, 0) / arr.length
}

function stdDev(arr: number[]): number {
  if (arr.length < 2) return 0
  const avg = mean(arr)
  const variance = arr.reduce((sum, v) => sum + Math.pow(v - avg, 2), 0) / (arr.length - 1)
  return Math.sqrt(variance)
}

/** Two decimals, the precision these ratios have always been stored at. */
function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function dailyReturns(snapshots: HistoricalSnapshot[]): number[] {
  if (snapshots.length < 2) return []
  const sorted = [...snapshots].sort(
    (a, b) => new Date(a.snapshot_date).getTime() - new Date(b.snapshot_date).getTime()
  )
  const returns: number[] = []
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1].total_value
    const curr = sorted[i].total_value
    if (prev > 0) {
      returns.push((curr - prev) / prev)
    }
  }
  return returns
}

function computeMaxDrawdown(snapshots: HistoricalSnapshot[]): number {
  if (snapshots.length < 2) return 0
  const sorted = [...snapshots].sort(
    (a, b) => new Date(a.snapshot_date).getTime() - new Date(b.snapshot_date).getTime()
  )
  let peak = sorted[0].total_value
  let maxDD = 0
  for (const snap of sorted) {
    if (snap.total_value > peak) peak = snap.total_value
    if (peak > 0) {
      const dd = (peak - snap.total_value) / peak
      if (dd > maxDD) maxDD = dd
    }
  }
  return maxDD
}

function computeHHI(weights: number[]): number {
  // Herfindahl-Hirschman Index: sum of squared weights
  // 0 = perfectly diversified, 1 = single position
  // We return 1 - HHI as diversification score (higher = more diversified)
  if (weights.length === 0) return 0
  const hhi = weights.reduce((sum, w) => sum + Math.pow(w, 2), 0)
  return Math.round((1 - hhi) * 100) / 100
}

function computeRiskScore(
  volatility: number,
  maxDrawdown: number,
  diversification: number,
  beta: number | null
): number {
  // Composite risk score 1-10
  // Higher = more risky
  let score = 0

  // Volatility contribution (0-3 points)
  // Annual vol < 10% = low, 10-20% = medium, 20-40% = high, 40%+ = very high
  const annualVol = volatility * Math.sqrt(TRADING_DAYS_PER_YEAR) * 100
  if (annualVol < 10) score += 1
  else if (annualVol < 20) score += 2
  else if (annualVol < 40) score += 3
  else score += 4

  // Max drawdown contribution (0-3 points)
  const ddPct = maxDrawdown * 100
  if (ddPct < 5) score += 0
  else if (ddPct < 15) score += 1
  else if (ddPct < 30) score += 2
  else score += 3

  // Diversification penalty (0-2 points)
  if (diversification < 0.3) score += 2
  else if (diversification < 0.6) score += 1

  // Beta contribution (0-1 point)
  if (beta !== null && Math.abs(beta) > 1.5) score += 1

  return Math.min(10, Math.max(1, score))
}

/**
 * Beta and alpha for this portfolio against the S&P 500, from the benchmark
 * closes already stored in benchmark_prices.
 *
 * The two return series have to line up day by day or the covariance means
 * nothing, so the snapshot dates are intersected with the dates the benchmark
 * actually has and both sides are turned into returns the same way. That matters
 * here: snapshot history is sparse (one row per cron run) and the benchmark
 * table has its own gaps.
 *
 * Returns null when the overlap is too short — the caller reports "no
 * disponible" rather than inventing a number.
 */
async function computeBenchmarkStats(
  supabase: SupabaseClient,
  history: HistoricalSnapshot[],
  riskFreeRate: number,
  benchmarkSymbol: string
): Promise<BetaAlpha | null> {
  const sorted = [...history]
    .filter((h) => h.total_value > 0)
    .sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date))
  if (sorted.length < 2) return null

  const series = await getBenchmarkSeries(
    supabase,
    benchmarkSymbol,
    sorted[0].snapshot_date,
    sorted[sorted.length - 1].snapshot_date
  )
  if (series.dates.length < 2) return null

  // getBenchmarkSeries normalises the series to start at 100, which leaves daily
  // returns untouched.
  const closeByDate = new Map(series.dates.map((date, i) => [date, series.values[i]]))
  const aligned = sorted.filter((h) => closeByDate.has(h.snapshot_date))
  if (aligned.length < 2) return null

  const portfolioReturns = calculateDailyReturns(aligned.map((h) => h.total_value))
  const benchmarkReturns = calculateDailyReturns(
    aligned.map((h) => closeByDate.get(h.snapshot_date)!)
  )

  return calculateBetaAlpha(portfolioReturns, benchmarkReturns, riskFreeRate)
}

// ─── Snapshot Computation ───────────────────────────────────────────────────

export async function computePortfolioSnapshot(
  supabase: SupabaseClient,
  portfolioId: string,
  today: string // YYYY-MM-DD
): Promise<SnapshotResult | null> {
  // 1. Fetch portfolio + positions
  // The column is base_currency; asking for `currency` failed every portfolio
  // with "column portfolios.currency does not exist", so no snapshot had been
  // written since the column was renamed.
  const { data: portfolio, error: pErr } = await supabase
    .from('portfolios')
    .select('id, name, currency:base_currency, user_id')
    .eq('id', portfolioId)
    .single()

  if (pErr || !portfolio) {
    console.error(`[snapshots] Portfolio ${portfolioId} not found:`, pErr)
    return null
  }

  const { data: positions, error: posErr } = await supabase
    .from('positions')
    .select('id, symbol, asset_type, quantity, avg_cost, currency')
    .eq('portfolio_id', portfolioId)

  if (posErr) {
    console.error(`[snapshots] Positions fetch failed for ${portfolioId}:`, posErr)
    return null
  }

  if (!positions || positions.length === 0) {
    // Empty portfolio — store zero snapshot
    return {
      portfolio_id: portfolioId,
      snapshot_date: today,
      total_value: 0,
      total_cost: 0,
      total_return: 0,
      total_return_pct: 0,
      position_count: 0,
      allocation: {},
      top_holdings: [],
      risk_score: null,
      sharpe_ratio: null,
      volatility: null,
      max_drawdown: null,
      beta: null,
      alpha: null,
      sortino_ratio: null,
      win_rate: null,
      diversification_score: null,
      currency: portfolio.currency,
      valuation_version: SNAPSHOT_VALUATION_VERSION,
    }
  }

  // 2. Fetch current prices
  const symbols = [...new Set(positions.map((p: Position) => p.symbol))]
  // The client here is the service role (crons and the backfill), so the
  // quotes it just fetched are published for everyone (quote-store.ts).
  const prices = await fetchCurrentPrices(symbols, supabase)

  // 3. Calculate portfolio value and allocation — in the portfolio's own
  // currency. Value converts each quote from the currency it trades in; cost
  // converts each average cost from the currency it was recorded in. Summing
  // units × quote against units × cost as one unit put a book holding dollar
  // assets bought in pesos at a 94% loss in total_return_pct — the figure the
  // returns tab, the leaderboard and Discover read (book-valuation.ts).
  const base = String(portfolio.currency ?? 'USD')
  const asOf = new Date(`${today}T23:59:59Z`)
  const valuation = await valueBookInBase(supabase, positions as Position[], prices, base, asOf)
  const costs = await valueBookInBase(supabase, positions as Position[], {}, base, asOf)
  const totalValue = valuation.total
  const totalCost = costs.total
  const positionValues: Array<{ symbol: string; value: number; cost: number; weight: number }> = (positions as Position[]).map(
    (pos, i) => ({ symbol: pos.symbol, value: valuation.values[i], cost: costs.values[i], weight: 0 }),
  )
  if (valuation.unconverted.length > 0 || costs.unconverted.length > 0) {
    console.warn(`[snapshots] ${portfolioId}: left unconverted`, [...new Set([...valuation.unconverted, ...costs.unconverted])])
  }

  // Calculate weights
  for (const pv of positionValues) {
    pv.weight = totalValue > 0 ? pv.value / totalValue : 0
  }

  // Allocation by asset type, on the same converted values.
  const allocation: Record<string, number> = {}
  ;(positions as Position[]).forEach((pos, i) => {
    const weight = totalValue > 0 ? (valuation.values[i] / totalValue) * 100 : 0
    allocation[pos.asset_type] = (allocation[pos.asset_type] || 0) + weight
  })
  // Round allocation values
  for (const key in allocation) {
    allocation[key] = Math.round(allocation[key] * 100) / 100
  }

  // Top holdings (sorted by weight, top 10)
  const topHoldings = positionValues
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 10)
    .map(pv => ({
      symbol: pv.symbol,
      weight: Math.round(pv.weight * 10000) / 100, // percentage
      value: Math.round(pv.value * 100) / 100
    }))

  // Returns
  const totalReturn = totalValue - totalCost
  const totalReturnPct = totalCost > 0 ? (totalReturn / totalCost) * 100 : 0

  // 4. Fetch historical snapshots for risk metrics (last 365 days)
  const oneYearAgo = new Date()
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)

  const { data: historicalSnapshots } = await supabase
    .from('portfolio_snapshots')
    .select('snapshot_date, total_value, total_return_pct')
    .eq('portfolio_id', portfolioId)
    .gte('snapshot_date', oneYearAgo.toISOString().split('T')[0])
    .gte('valuation_version', SNAPSHOT_VALUATION_VERSION)
    .order('snapshot_date', { ascending: true })

  const history: HistoricalSnapshot[] = historicalSnapshots || []

  // Add today's value to history for computation
  const todaySnap: HistoricalSnapshot = {
    snapshot_date: today,
    total_value: totalValue,
    total_return_pct: totalReturnPct
  }
  const fullHistory = [...history.filter(h => h.snapshot_date !== today), todaySnap]

  // 5. Compute risk metrics
  const returns = dailyReturns(fullHistory)

  let volatilityVal: number | null = null
  let sharpeVal: number | null = null
  let sortinoVal: number | null = null
  let maxDrawdownVal: number | null = null
  let betaVal: number | null = null
  let alphaVal: number | null = null
  let winRateVal: number | null = null
  let diversificationVal: number | null = null
  let riskScoreVal: number | null = null

  // The rate to beat is the one an investor in this portfolio's currency could
  // get risk-free: CETES for a peso book, T-Bills for a dollar one. Resolved
  // once per snapshot and reused for Sharpe, Sortino and Jensen's alpha.
  const riskFree = await getRiskFreeRate(portfolio.currency)

  if (returns.length >= 5) {
    // Daily volatility
    volatilityVal = stdDev(returns)

    // Sharpe and Sortino come from the functions the rest of the app uses, not
    // from a second copy of the same arithmetic written out here. The two
    // agreed to the last digit — a test now pins that they keep agreeing — but
    // two copies of a formula is two places for it to drift, which is what rule
    // 2 of the roadmap forbids.
    //
    // Rounded to two decimals on the way into the column, as before. Sortino is
    // null rather than 0 when it cannot be measured: a portfolio that never had
    // a down day has no downside deviation to divide by, and 0 would claim it
    // earned nothing per unit of a risk it did not take.
    sharpeVal = round2(calculateSharpeRatio(returns, riskFree.rate))
    const sortino = calculateSortinoRatio(returns, riskFree.rate, TRADING_DAYS_PER_YEAR)
    sortinoVal = sortino === null ? null : round2(sortino)

    // Max Drawdown
    maxDrawdownVal = computeMaxDrawdown(fullHistory)
    maxDrawdownVal = Math.round(maxDrawdownVal * 10000) / 10000

    // Win Rate (% of positive return days)
    const positivedays = returns.filter(r => r > 0).length
    winRateVal = Math.round((positivedays / returns.length) * 10000) / 10000

    // Beta and Alpha against the real S&P 500 series, aligned to this
    // portfolio's own snapshot dates. Both stay null when there is not enough
    // overlapping benchmark history: the previous approximation
    // (portfolio_vol / an assumed 1% daily benchmark vol) implied a correlation
    // of 1 with the market and overstated beta for any diversified portfolio,
    // which is worse than showing nothing.
    const benchmarkSymbol = await getPortfolioBenchmark(supabase, portfolioId)
    const benchmarkStats = await computeBenchmarkStats(
      supabase,
      fullHistory,
      riskFree.rate,
      benchmarkSymbol
    )
    if (benchmarkStats) {
      betaVal = Math.round(benchmarkStats.beta * 100) / 100
      // calculateBetaAlpha returns percentage points; this column holds a fraction.
      alphaVal = Math.round((benchmarkStats.alpha / 100) * 10000) / 10000
    }

    // Diversification (HHI-based)
    const weights = positionValues.map(pv => pv.weight)
    diversificationVal = computeHHI(weights)

    // Risk Score
    riskScoreVal = computeRiskScore(volatilityVal, maxDrawdownVal, diversificationVal, betaVal)
  } else if (positionValues.length > 0) {
    // Not enough history for risk metrics, but can compute diversification
    const weights = positionValues.map(pv => pv.weight)
    diversificationVal = computeHHI(weights)
  }

  // Round values
  volatilityVal = volatilityVal !== null ? Math.round(volatilityVal * 10000) / 10000 : null

  return {
    portfolio_id: portfolioId,
    snapshot_date: today,
    total_value: Math.round(totalValue * 100) / 100,
    total_cost: Math.round(totalCost * 100) / 100,
    total_return: Math.round(totalReturn * 100) / 100,
    total_return_pct: Math.round(totalReturnPct * 100) / 100,
    position_count: positions.length,
    allocation,
    top_holdings: topHoldings,
    risk_score: riskScoreVal,
    sharpe_ratio: sharpeVal,
    volatility: volatilityVal,
    max_drawdown: maxDrawdownVal,
    beta: betaVal,
    alpha: alphaVal,
    sortino_ratio: sortinoVal,
    win_rate: winRateVal,
    diversification_score: diversificationVal,
    currency: portfolio.currency,
    valuation_version: SNAPSHOT_VALUATION_VERSION,
  }
}

// ─── Batch Snapshot Runner ──────────────────────────────────────────────────

export async function runNightlySnapshots(): Promise<{
  processed: number
  errors: number
  portfolioIds: string[]
}> {
  const supabase = createAdminSupabase()
  const today = new Date().toISOString().split('T')[0]

  // Every portfolio that has not been deleted
  const { data: portfolios, error: fetchErr } = await supabase
    .from('portfolios')
    .select('id')
    .is('deleted_at', null)
    .order('created_at', { ascending: true })

  if (fetchErr || !portfolios) {
    console.error('[snapshots] Failed to fetch portfolios:', fetchErr)
    return { processed: 0, errors: 1, portfolioIds: [] }
  }

  let processed = 0
  let errors = 0
  const processedIds: string[] = []

  // Process in batches of 5 to avoid rate limiting
  for (let i = 0; i < portfolios.length; i += 5) {
    const batch = portfolios.slice(i, i + 5)

    const results = await Promise.allSettled(
      batch.map(p => computePortfolioSnapshot(supabase, p.id, today))
    )

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        // Upsert snapshot (unique on portfolio_id + snapshot_date)
        const { error: upsertErr } = await supabase
          .from('portfolio_snapshots')
          .upsert(result.value, {
            onConflict: 'portfolio_id,snapshot_date'
          })

        if (upsertErr) {
          console.error(`[snapshots] Upsert failed for ${result.value.portfolio_id}:`, upsertErr)
          errors++
        } else {
          processed++
          processedIds.push(result.value.portfolio_id)
        }
      } else {
        // A snapshot that could not be computed is a failure, not a skip: it was
        // counted as neither, so a run that wrote nothing reported success.
        if (result.status === 'rejected') console.error('[snapshots] Computation failed:', result.reason)
        errors++
      }
    }

    // Pause between batches
    if (i + 5 < portfolios.length) {
      await new Promise(r => setTimeout(r, 2000))
    }
  }

  console.log(`[snapshots] Nightly run complete: ${processed} processed, ${errors} errors`)
  return { processed, errors, portfolioIds: processedIds }
}

// ─── Leaderboard Refresh ────────────────────────────────────────────────────

/**
 * Rebuild leaderboard_cache from today's snapshots of public portfolios.
 *
 * The table holds one row per (category, period) with the ranking as JSON. The
 * previous version inserted one row per portfolio with portfolio_id, rank,
 * score and metadata — columns the table does not have — after selecting
 * profiles through portfolios, which PostgREST cannot embed: both tables point
 * at auth.users, not at each other. It failed at the select, every night.
 * Profiles are now read in a second query and joined here.
 *
 * Every category is written even when empty, so the page reads "no portfolios
 * yet" instead of a missing row.
 */
export async function refreshLeaderboard(): Promise<{ portfolios: number }> {
  const supabase = createAdminSupabase()
  const today = new Date().toISOString().split('T')[0]

  const { data: snapshots, error: snapErr } = await supabase
    .from('portfolio_snapshots')
    .select(`
      portfolio_id,
      total_value,
      total_return_pct,
      sharpe_ratio,
      volatility,
      win_rate,
      portfolios!inner(name, user_id, like_count, visibility, deleted_at)
    `)
    .eq('snapshot_date', today)
    .gte('valuation_version', SNAPSHOT_VALUATION_VERSION)
    .eq('portfolios.visibility', 'public')
    .is('portfolios.deleted_at', null)

  if (snapErr || !snapshots) {
    throw new Error(`[leaderboard] could not read snapshots: ${snapErr?.message ?? 'no data'}`)
  }

  const rows: LeaderboardSnapshot[] = snapshots.map((s) => {
    const portfolio = s.portfolios as unknown as { name: string; user_id: string; like_count: number | null }
    return {
      portfolio_id: s.portfolio_id,
      portfolio_name: portfolio.name,
      user_id: portfolio.user_id,
      like_count: portfolio.like_count,
      total_value: s.total_value,
      total_return_pct: s.total_return_pct,
      sharpe_ratio: s.sharpe_ratio,
      volatility: s.volatility,
      win_rate: s.win_rate,
    }
  })

  const userIds = [...new Set(rows.map((r) => r.user_id))]
  let profiles: LeaderboardProfile[] = []
  if (userIds.length > 0) {
    const { data, error: profileErr } = await supabase
      .from('profiles')
      .select('user_id, username, display_name, avatar_url')
      .in('user_id', userIds)
    if (profileErr) throw new Error(`[leaderboard] could not read profiles: ${profileErr.message}`)
    profiles = (data ?? []) as LeaderboardProfile[]
  }

  const boards = buildLeaderboards(rows, profiles)
  const computedAt = new Date()
  const { error: writeErr } = await supabase.from('leaderboard_cache').upsert(
    LEADERBOARD_CATEGORIES.map((category) => ({
      category,
      period: LEADERBOARD_PERIOD,
      rankings: boards[category],
      computed_at: computedAt.toISOString(),
      // Until the next nightly run, with an hour to spare.
      expires_at: new Date(computedAt.getTime() + 25 * 60 * 60 * 1000).toISOString(),
    })),
    { onConflict: 'category,period' },
  )
  if (writeErr) throw new Error(`[leaderboard] could not write rankings: ${writeErr.message}`)

  console.log(`[leaderboard] Refreshed with ${rows.length} public portfolios`)
  return { portfolios: rows.length }
}
