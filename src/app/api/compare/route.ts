import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { validate } from '@/lib/api/validate'
import { SaveComparisonSchema } from '@/lib/schemas/social'
import { getCachedComparison, cacheComparison, CACHE_KEYS } from '@/lib/cache/redis'

type Period = '1M' | '3M' | '6M' | '1Y' | '5Y' | 'ALL'

function getPeriodDays(period: string): number {
  const map: Record<string, number> = {
    '1W': 7, '1M': 30, '3M': 90, '6M': 180,
    'YTD': Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 1).getTime()) / 86400000),
    '1Y': 365, '3Y': 1095, '5Y': 1825, 'ALL': 10000
  }
  return map[period] || 365
}

export async function GET(req: Request) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const { searchParams } = new URL(req.url)
  const ids = searchParams.get('ids')
  const period = searchParams.get('period') || '1Y'

  if (!ids) return error('ids query parameter is required', 400)

  const portfolioIds = ids.split(',').filter(Boolean).slice(0, 5)
  if (portfolioIds.length === 0) return error('At least one portfolio ID required', 400)

  // Check cache first
  const cached = await getCachedComparison(portfolioIds, period)
  if (cached) {
    return success(cached)
  }

  const periodDays = getPeriodDays(period)
  const startDate = new Date(Date.now() - periodDays * 86400000)
    .toISOString().split('T')[0]

  // Fetch the latest snapshot for each portfolio (metrics)
  const { data: latestSnapshots, error: latestErr } = await supabase
    .from('portfolio_snapshots')
    .select(`
      portfolio_id,
      snapshot_date,
      total_value,
      total_cost,
      total_return,
      total_return_pct,
      position_count,
      allocation,
      top_holdings,
      risk_score,
      sharpe_ratio,
      volatility,
      max_drawdown,
      beta,
      alpha,
      sortino_ratio,
      win_rate,
      diversification_score,
      currency
    `)
    .in('portfolio_id', portfolioIds)
    .order('snapshot_date', { ascending: false })

  if (latestErr) return error(latestErr.message, 500)

  // Fetch portfolio names
  const { data: portfolios, error: pErr } = await supabase
    .from('portfolios')
    .select('id, name, currency, visibility')
    .in('id', portfolioIds)

  if (pErr) return error(pErr.message, 500)

  const portfolioMap = new Map(
    (portfolios || []).map((p: any) => [p.id, p])
  )

  // Get latest snapshot per portfolio
  const latestByPortfolio = new Map<string, any>()
  for (const snap of (latestSnapshots || [])) {
    if (!latestByPortfolio.has(snap.portfolio_id)) {
      latestByPortfolio.set(snap.portfolio_id, snap)
    }
  }

  // Get period-start snapshot for period return calculation
  const { data: periodStartSnapshots } = await supabase
    .from('portfolio_snapshots')
    .select('portfolio_id, total_value, snapshot_date')
    .in('portfolio_id', portfolioIds)
    .gte('snapshot_date', startDate)
    .order('snapshot_date', { ascending: true })

  const periodStartByPortfolio = new Map<string, any>()
  for (const snap of (periodStartSnapshots || [])) {
    if (!periodStartByPortfolio.has(snap.portfolio_id)) {
      periodStartByPortfolio.set(snap.portfolio_id, snap)
    }
  }

  // Build comparison metrics
  const metrics = portfolioIds.map(id => {
    const portfolio = portfolioMap.get(id)
    const latest = latestByPortfolio.get(id)
    const periodStart = periodStartByPortfolio.get(id)

    if (!portfolio) return null

    // Period-specific return
    let periodReturn = 0
    let periodReturnPct = 0
    if (latest && periodStart && periodStart.total_value > 0) {
      periodReturn = latest.total_value - periodStart.total_value
      periodReturnPct = (periodReturn / periodStart.total_value) * 100
    }

    return {
      portfolioId: id,
      portfolioName: portfolio.name,
      currentValue: latest?.total_value ?? 0,
      totalCost: latest?.total_cost ?? 0,
      totalReturn: latest?.total_return ?? 0,
      returnPercent: latest?.total_return_pct ?? 0,
      periodReturn: Math.round(periodReturn * 100) / 100,
      periodReturnPct: Math.round(periodReturnPct * 100) / 100,
      positionCount: latest?.position_count ?? 0,
      allocation: latest?.allocation ?? {},
      topHoldings: latest?.top_holdings ?? [],
      // Risk metrics
      riskScore: latest?.risk_score ?? null,
      sharpeRatio: latest?.sharpe_ratio ?? null,
      volatility: latest?.volatility ?? null,
      maxDrawdown: latest?.max_drawdown ?? null,
      beta: latest?.beta ?? null,
      alpha: latest?.alpha ?? null,
      sortinoRatio: latest?.sortino_ratio ?? null,
      winRate: latest?.win_rate ?? null,
      diversificationScore: latest?.diversification_score ?? null,
      currency: latest?.currency ?? portfolio.currency
    }
  }).filter(Boolean)

  const response = {
    period,
    startDate,
    endDate: new Date().toISOString().split('T')[0],
    metrics
  }

  // Cache the result (30 minutes)
  await cacheComparison(portfolioIds, period, response, 1800)

  return success(response)
}

export async function POST(req: Request) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  let body
  try { body = await req.json() } catch { return error('Invalid JSON', 400) }
  const result = await validate(SaveComparisonSchema, body)
  if ('error' in result) return result.error

  const { data, error: dbError } = await supabase
    .from('saved_comparisons')
    .insert({
      ...result.data,
      user_id: user.id,
    })
    .select()
    .single()

  if (dbError) return error(dbError.message, 500)
  return success(data, undefined, 201)
}
