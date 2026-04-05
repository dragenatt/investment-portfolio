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

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

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
}

// ─── Constants ──────────────────────────────────────────────────────────────

const RISK_FREE_RATE = 0.0425 // ~4.25% annual (US T-Bills approximate)
const TRADING_DAYS_PER_YEAR = 252
const BENCHMARK_ANNUAL_RETURN = 0.10 // S&P 500 historical ~10%

// ─── Supabase Admin Client ──────────────────────────────────────────────────

export function createAdminSupabase(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  })
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
  await supabase
    .from('cron_runs')
    .update({
      status,
      finished_at: new Date().toISOString(),
      portfolios_processed: result.processed,
      portfolios_failed: result.errors,
      error_details: result.errorDetails ?? null,
      duration_ms: Date.now(), // will be calculated in route
    })
    .eq('id', runId)
}

// ─── Price Fetching ─────────────────────────────────────────────────────────

async function fetchCurrentPrices(
  symbols: string[]
): Promise<Record<string, number>> {
  const prices: Record<string, number> = {}

  if (symbols.length === 0) return prices

  // Try Twelve Data batch endpoint first
  const apiKey = process.env.TWELVE_DATA_API_KEY
  if (apiKey) {
    try {
      const batchSize = 8 // Twelve Data free tier limit
      for (let i = 0; i < symbols.length; i += batchSize) {
        const batch = symbols.slice(i, i + batchSize)
        const symbolStr = batch.join(',')
        const res = await fetch(
          `https://api.twelvedata.com/price?symbol=${symbolStr}&apikey=${apiKey}`,
          { signal: AbortSignal.timeout(10000) }
        )
        if (res.ok) {
          const data = await res.json()
          // Single symbol returns { price: "123.45" }
          // Multiple symbols returns { AAPL: { price: "..." }, ... }
          if (batch.length === 1 && data.price) {
            prices[batch[0]] = parseFloat(data.price)
          } else {
            for (const sym of batch) {
              if (data[sym]?.price) {
                prices[sym] = parseFloat(data[sym].price)
              }
            }
          }
        }
        // Rate limit: wait 1s between batches
        if (i + batchSize < symbols.length) {
          await new Promise(r => setTimeout(r, 1200))
        }
      }
    } catch (err) {
      console.warn('[snapshots] Twelve Data batch failed, trying Finnhub fallback', err)
    }
  }

  // Fallback to Finnhub for missing symbols
  const finnhubKey = process.env.FINNHUB_API_KEY
  const missing = symbols.filter(s => !(s in prices))
  if (finnhubKey && missing.length > 0) {
    for (const symbol of missing) {
      try {
        const res = await fetch(
          `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${finnhubKey}`,
          { signal: AbortSignal.timeout(8000) }
        )
        if (res.ok) {
          const data = await res.json()
          if (data.c && data.c > 0) {
            prices[symbol] = data.c
          }
        }
        // Finnhub rate limit: 60/min
        await new Promise(r => setTimeout(r, 1100))
      } catch {
        console.warn(`[snapshots] Failed to fetch price for ${symbol}`)
      }
    }
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

function downsideDev(returns: number[], threshold: number = 0): number {
  const downside = returns.filter(r => r < threshold).map(r => Math.pow(r - threshold, 2))
  if (downside.length === 0) return 0
  return Math.sqrt(downside.reduce((s, v) => s + v, 0) / returns.length)
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

// ─── Snapshot Computation ───────────────────────────────────────────────────

export async function computePortfolioSnapshot(
  supabase: SupabaseClient,
  portfolioId: string,
  today: string // YYYY-MM-DD
): Promise<SnapshotResult | null> {
  // 1. Fetch portfolio + positions
  const { data: portfolio, error: pErr } = await supabase
    .from('portfolios')
    .select('id, name, currency, user_id')
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
      currency: portfolio.currency
    }
  }

  // 2. Fetch current prices
  const symbols = [...new Set(positions.map((p: Position) => p.symbol))]
  const prices = await fetchCurrentPrices(symbols)

  // 3. Calculate portfolio value and allocation
  let totalValue = 0
  let totalCost = 0
  const positionValues: Array<{ symbol: string; value: number; cost: number; weight: number }> = []

  for (const pos of positions as Position[]) {
    const price = prices[pos.symbol]
    if (!price) {
      // Use avg_cost as fallback if no price available
      const value = pos.quantity * pos.avg_cost
      totalValue += value
      totalCost += pos.quantity * pos.avg_cost
      positionValues.push({ symbol: pos.symbol, value, cost: pos.quantity * pos.avg_cost, weight: 0 })
    } else {
      const value = pos.quantity * price
      totalValue += value
      totalCost += pos.quantity * pos.avg_cost
      positionValues.push({ symbol: pos.symbol, value, cost: pos.quantity * pos.avg_cost, weight: 0 })
    }
  }

  // Calculate weights
  for (const pv of positionValues) {
    pv.weight = totalValue > 0 ? pv.value / totalValue : 0
  }

  // Allocation by asset type
  const allocation: Record<string, number> = {}
  for (const pos of positions as Position[]) {
    const price = prices[pos.symbol] || pos.avg_cost
    const value = pos.quantity * price
    const weight = totalValue > 0 ? (value / totalValue) * 100 : 0
    allocation[pos.asset_type] = (allocation[pos.asset_type] || 0) + weight
  }
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

  if (returns.length >= 5) {
    // Daily volatility
    volatilityVal = stdDev(returns)

    // Annualized volatility for Sharpe
    const annualVol = volatilityVal * Math.sqrt(TRADING_DAYS_PER_YEAR)

    // Annualized return
    const avgDailyReturn = mean(returns)
    const annualReturn = avgDailyReturn * TRADING_DAYS_PER_YEAR

    // Sharpe Ratio = (annualized return - risk-free rate) / annualized volatility
    sharpeVal = annualVol > 0
      ? Math.round(((annualReturn - RISK_FREE_RATE) / annualVol) * 100) / 100
      : 0

    // Sortino Ratio = (annualized return - risk-free rate) / downside deviation
    const annualDownside = downsideDev(returns) * Math.sqrt(TRADING_DAYS_PER_YEAR)
    sortinoVal = annualDownside > 0
      ? Math.round(((annualReturn - RISK_FREE_RATE) / annualDownside) * 100) / 100
      : 0

    // Max Drawdown
    maxDrawdownVal = computeMaxDrawdown(fullHistory)
    maxDrawdownVal = Math.round(maxDrawdownVal * 10000) / 10000

    // Win Rate (% of positive return days)
    const positivedays = returns.filter(r => r > 0).length
    winRateVal = Math.round((positivedays / returns.length) * 10000) / 10000

    // Beta and Alpha (vs benchmark assumed S&P 500)
    // Simplified: assume benchmark has BENCHMARK_ANNUAL_RETURN with daily vol of ~1%
    const benchmarkDailyReturn = BENCHMARK_ANNUAL_RETURN / TRADING_DAYS_PER_YEAR
    // Without actual benchmark data, estimate beta from correlation assumption
    // Beta ≈ portfolio_vol / benchmark_vol (simplified approximation)
    const benchmarkDailyVol = 0.01 // ~16% annual vol for S&P 500
    betaVal = Math.round((volatilityVal / benchmarkDailyVol) * 100) / 100

    // Alpha = actual annual return - (risk-free + beta * (benchmark return - risk-free))
    const expectedReturn = RISK_FREE_RATE + betaVal * (BENCHMARK_ANNUAL_RETURN - RISK_FREE_RATE)
    alphaVal = Math.round((annualReturn - expectedReturn) * 10000) / 10000

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
    currency: portfolio.currency
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

  // Fetch all portfolios that have at least one position
  const { data: portfolios, error: fetchErr } = await supabase
    .from('portfolios')
    .select('id')
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
      } else if (result.status === 'rejected') {
        console.error('[snapshots] Computation failed:', result.reason)
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

export async function refreshLeaderboard(): Promise<void> {
  const supabase = createAdminSupabase()
  const today = new Date().toISOString().split('T')[0]

  // Get today's snapshots for public portfolios with good data
  const { data: snapshots, error: snapErr } = await supabase
    .from('portfolio_snapshots')
    .select(`
      portfolio_id,
      total_value,
      total_return_pct,
      sharpe_ratio,
      volatility,
      max_drawdown,
      win_rate,
      risk_score,
      portfolios!inner(id, name, visibility, user_id, profiles(username, display_name, avatar_url))
    `)
    .eq('snapshot_date', today)
    .eq('portfolios.visibility', 'public')
    .gt('total_value', 0)

  if (snapErr || !snapshots) {
    console.error('[leaderboard] Failed to fetch snapshots:', snapErr)
    return
  }

  // Clear old leaderboard
  await supabase.from('leaderboard_cache').delete().neq('id', '00000000-0000-0000-0000-000000000000')

  // Categories to rank
  const categories = ['return', 'sharpe', 'risk_adjusted', 'consistency'] as const

  for (const category of categories) {
    const ranked = [...snapshots]
      .sort((a, b) => {
        switch (category) {
          case 'return': return (b.total_return_pct || 0) - (a.total_return_pct || 0)
          case 'sharpe': return (b.sharpe_ratio || 0) - (a.sharpe_ratio || 0)
          case 'risk_adjusted': return (b.sharpe_ratio || 0) - (a.sharpe_ratio || 0)
          case 'consistency': return (b.win_rate || 0) - (a.win_rate || 0)
          default: return 0
        }
      })
      .slice(0, 50) // Top 50 per category

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const leaderboardEntries = ranked.map((s: any, idx: number) => ({
      portfolio_id: s.portfolio_id,
      user_id: s.portfolios.user_id,
      category,
      period: 'all',
      rank: idx + 1,
      score: (() => {
        switch (category) {
          case 'return': return s.total_return_pct || 0
          case 'sharpe': return s.sharpe_ratio || 0
          case 'risk_adjusted': return s.sharpe_ratio || 0
          case 'consistency': return s.win_rate || 0
          default: return 0
        }
      })(),
      metadata: {
        portfolio_name: s.portfolios.name,
        username: s.portfolios.profiles?.username,
        display_name: s.portfolios.profiles?.display_name,
        avatar_url: s.portfolios.profiles?.avatar_url,
        total_value: s.total_value,
        volatility: s.volatility,
        max_drawdown: s.max_drawdown,
        risk_score: s.risk_score
      }
    }))

    if (leaderboardEntries.length > 0) {
      const { error: insertErr } = await supabase
        .from('leaderboard_cache')
        .insert(leaderboardEntries)

      if (insertErr) {
        console.error(`[leaderboard] Insert failed for ${category}:`, insertErr)
      }
    }
  }

  console.log(`[leaderboard] Refreshed with ${snapshots.length} public portfolios`)
}
