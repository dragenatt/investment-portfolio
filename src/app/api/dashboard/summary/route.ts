import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { withCache } from '@/lib/cache/with-cache'
import { getBatchQuotes } from '@/lib/services/market'

export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const data = await withCache(
    `${'dashboard:summary:'}${user.id}`,
    120, // 2 minutes
    async () => {
      // Get all user portfolios with positions
      const { data: portfolios } = await supabase
        .from('portfolios')
        .select('id')
        .eq('user_id', user.id)
        .is('deleted_at', null)

      if (!portfolios || portfolios.length === 0) {
        return { total_value: 0, total_cost: 0, total_return: 0, total_return_pct: 0, daily_change: 0, daily_change_pct: 0, weekly_change: 0, weekly_change_pct: 0, best_position: null, worst_position: null }
      }

      const pids = portfolios.map((p) => p.id)

      // Get all positions with current prices
      const { data: positions } = await supabase
        .from('positions')
        .select('symbol, quantity, avg_cost, currency, portfolio_id')
        .in('portfolio_id', pids)
        .gt('quantity', 0)

      if (!positions || positions.length === 0) {
        return { total_value: 0, total_cost: 0, total_return: 0, total_return_pct: 0, daily_change: 0, daily_change_pct: 0, weekly_change: 0, weekly_change_pct: 0, best_position: null, worst_position: null }
      }

      // Fetch live prices from market service (Twelve Data → Finnhub → Yahoo)
      const symbols = [...new Set(positions.map((p) => p.symbol))]
      const liveQuotes = await getBatchQuotes(symbols)

      // Build price map: live price takes priority, then current_prices table, then avg_cost
      const priceMap: Record<string, { price: number; changePct: number; currency: string }> = {}
      for (const sym of symbols) {
        const live = liveQuotes[sym] || liveQuotes[sym.toUpperCase()]
        if (live?.price != null) {
          priceMap[sym] = { price: live.price, changePct: live.changePct ?? 0, currency: live.currency || 'USD' }
        }
      }

      // Fallback: check current_prices table for symbols not found via live quotes
      const missingSymbols = symbols.filter(s => !priceMap[s])
      if (missingSymbols.length > 0) {
        const { data: dbPrices } = await supabase
          .from('current_prices')
          .select('symbol, price')
          .in('symbol', missingSymbols)
        for (const p of dbPrices ?? []) {
          priceMap[p.symbol] = { price: p.price, changePct: 0, currency: 'USD' }
        }
      }

      // Calculate totals (all values in their original currency — client handles conversion)
      let totalValue = 0
      let totalCost = 0
      let bestPos = { symbol: '', pct: -Infinity }
      let worstPos = { symbol: '', pct: Infinity }

      for (const pos of positions) {
        const liveData = priceMap[pos.symbol]
        const price = liveData?.price ?? pos.avg_cost
        const value = pos.quantity * price
        const cost = pos.quantity * pos.avg_cost
        totalValue += value
        totalCost += cost

        const pct = cost > 0 ? ((value - cost) / cost) * 100 : 0
        if (pct > bestPos.pct) bestPos = { symbol: pos.symbol, pct }
        if (pct < worstPos.pct) worstPos = { symbol: pos.symbol, pct }
      }

      const totalReturn = totalValue - totalCost
      const totalReturnPct = totalCost > 0 ? (totalReturn / totalCost) * 100 : 0

      // Get yesterday's and last week's snapshots for change calculation
      const today = new Date()
      const yesterday = new Date(today)
      yesterday.setDate(yesterday.getDate() - 1)
      const lastWeek = new Date(today)
      lastWeek.setDate(lastWeek.getDate() - 7)

      const { data: snapshots } = await supabase
        .from('portfolio_snapshots')
        .select('portfolio_id, snapshot_date, total_value')
        .in('portfolio_id', pids)
        .gte('snapshot_date', lastWeek.toISOString().split('T')[0])
        .order('snapshot_date', { ascending: false })

      let yesterdayTotal = 0
      let weekAgoTotal = 0
      const yesterdayStr = yesterday.toISOString().split('T')[0]
      const weekAgoStr = lastWeek.toISOString().split('T')[0]

      for (const pid of pids) {
        const pidSnaps = snapshots?.filter((s) => s.portfolio_id === pid) ?? []
        const ySnap = pidSnaps.find((s) => s.snapshot_date <= yesterdayStr)
        const wSnap = pidSnaps.find((s) => s.snapshot_date <= weekAgoStr)
        if (ySnap) yesterdayTotal += ySnap.total_value
        if (wSnap) weekAgoTotal += wSnap.total_value
      }

      const dailyChange = yesterdayTotal > 0 ? totalValue - yesterdayTotal : 0
      const dailyChangePct = yesterdayTotal > 0 ? (dailyChange / yesterdayTotal) * 100 : 0
      const weeklyChange = weekAgoTotal > 0 ? totalValue - weekAgoTotal : 0
      const weeklyChangePct = weekAgoTotal > 0 ? (weeklyChange / weekAgoTotal) * 100 : 0

      return {
        total_value: Math.round(totalValue * 100) / 100,
        total_cost: Math.round(totalCost * 100) / 100,
        total_return: Math.round(totalReturn * 100) / 100,
        total_return_pct: Math.round(totalReturnPct * 100) / 100,
        daily_change: Math.round(dailyChange * 100) / 100,
        daily_change_pct: Math.round(dailyChangePct * 100) / 100,
        weekly_change: Math.round(weeklyChange * 100) / 100,
        weekly_change_pct: Math.round(weeklyChangePct * 100) / 100,
        best_position: bestPos.symbol ? { symbol: bestPos.symbol, pnl_percent: bestPos.pct } : null,
        worst_position: worstPos.symbol ? { symbol: worstPos.symbol, pnl_percent: worstPos.pct } : null,
      }
    }
  )
  return success(data)
}
