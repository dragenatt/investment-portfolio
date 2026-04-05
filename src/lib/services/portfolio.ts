import { type SupabaseClient } from '@supabase/supabase-js'

export async function getUserPortfolios(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from('portfolios')
    .select(`
      *,
      positions (
        id, symbol, asset_type, quantity, avg_cost, currency
      )
    `)
    .eq('user_id', userId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })

  return { data, error }
}

export async function getPortfolioDetail(supabase: SupabaseClient, portfolioId: string) {
  const { data, error } = await supabase
    .from('portfolios')
    .select(`
      *,
      positions (
        id, symbol, asset_type, quantity, avg_cost, currency, opened_at,
        transactions (id, type, quantity, price, fees, currency, executed_at, notes, created_at)
      )
    `)
    .eq('id', portfolioId)
    .is('deleted_at', null)
    .single()

  return { data, error }
}

/**
 * Enrich positions with current prices, P&L, and sparkline data.
 */
export async function enrichPositionsWithPnL(
  supabase: SupabaseClient,
  positions: Array<{ symbol: string; quantity: number; avg_cost: number; [key: string]: unknown }>
): Promise<Array<{
  symbol: string
  quantity: number
  avg_cost: number
  current_price: number
  market_value: number
  pnl_absolute: number
  pnl_percent: number
  daily_change: number
  daily_change_pct: number
  sparkline_7d: number[]
  is_stale: boolean
  [key: string]: unknown
}>> {
  if (positions.length === 0) return []

  const symbols = positions.map((p) => p.symbol)

  // Get current prices
  const { data: prices } = await supabase
    .from('current_prices')
    .select('symbol, price, fetched_at')
    .in('symbol', symbols)

  const priceMap: Record<string, { price: number; fetched_at: string }> = {}
  for (const p of prices ?? []) priceMap[p.symbol] = p

  // Get last 7 days of price history for sparklines
  const sevenDaysAgo = new Date()
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
  const { data: history } = await supabase
    .from('price_history')
    .select('symbol, date, close')
    .in('symbol', symbols)
    .gte('date', sevenDaysAgo.toISOString().split('T')[0])
    .order('date', { ascending: true })

  const sparkMap: Record<string, number[]> = {}
  for (const h of history ?? []) {
    if (!sparkMap[h.symbol]) sparkMap[h.symbol] = []
    sparkMap[h.symbol].push(h.close)
  }

  // Get yesterday's close for daily change
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  const yesterdayStr = yesterday.toISOString().split('T')[0]

  const prevCloseMap: Record<string, number> = {}
  for (const sym of symbols) {
    const closes = sparkMap[sym] ?? []
    // Find the close for yesterday or the most recent before today
    if (closes.length >= 2) {
      prevCloseMap[sym] = closes[closes.length - 2]
    }
  }

  const now = Date.now()
  const staleThreshold = 24 * 60 * 60 * 1000 // 24 hours

  return positions.map((pos) => {
    const priceData = priceMap[pos.symbol]
    const currentPrice = priceData?.price ?? pos.avg_cost
    const isStale = priceData
      ? now - new Date(priceData.fetched_at).getTime() > staleThreshold
      : true

    const marketValue = pos.quantity * currentPrice
    const costBasis = pos.quantity * pos.avg_cost
    const pnlAbsolute = marketValue - costBasis
    const pnlPercent = costBasis > 0 ? (pnlAbsolute / costBasis) * 100 : 0

    const prevClose = prevCloseMap[pos.symbol]
    const dailyChange = prevClose ? (currentPrice - prevClose) * pos.quantity : 0
    const dailyChangePct = prevClose && prevClose > 0 ? ((currentPrice - prevClose) / prevClose) * 100 : 0

    return {
      ...pos,
      current_price: currentPrice,
      market_value: Math.round(marketValue * 100) / 100,
      pnl_absolute: Math.round(pnlAbsolute * 100) / 100,
      pnl_percent: Math.round(pnlPercent * 100) / 100,
      daily_change: Math.round(dailyChange * 100) / 100,
      daily_change_pct: Math.round(dailyChangePct * 100) / 100,
      sparkline_7d: sparkMap[pos.symbol] ?? [],
      is_stale: isStale,
    }
  })
}
