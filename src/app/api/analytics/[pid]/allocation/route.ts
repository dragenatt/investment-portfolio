import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { withCache } from '@/lib/cache/with-cache'
import { CACHE_KEYS } from '@/lib/cache/redis'

export async function GET(_req: Request, { params }: { params: Promise<{ pid: string }> }) {
  const { pid } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const data = await withCache(
    `${CACHE_KEYS.ANALYTICS_ALLOCATION}${pid}`,
    300,
    async () => {
      // Get positions
      const { data: positions } = await supabase
        .from('positions')
        .select('symbol, asset_type, quantity, avg_cost, currency')
        .eq('portfolio_id', pid)
        .gt('quantity', 0)

      if (!positions || positions.length === 0) return { byType: [], bySymbol: [], total: 0 }

      // Get current prices for all position symbols
      const symbols = positions.map((p) => p.symbol)
      const { data: prices } = await supabase
        .from('current_prices')
        .select('symbol, price')
        .in('symbol', symbols)

      const priceMap: Record<string, number> = {}
      for (const p of prices ?? []) {
        priceMap[p.symbol] = p.price
      }

      // Get sector data from company_data
      const { data: companies } = await supabase
        .from('company_data')
        .select('symbol, sector, market_cap')
        .in('symbol', symbols)

      const sectorMap: Record<string, string> = {}
      const capMap: Record<string, number> = {}
      for (const c of companies ?? []) {
        sectorMap[c.symbol] = c.sector ?? 'Unknown'
        capMap[c.symbol] = c.market_cap ?? 0
      }

      // Calculate using market value (current price), fallback to avg_cost
      const byType: Record<string, number> = {}
      const bySector: Record<string, number> = {}
      const bySymbol: Array<{ symbol: string; value: number; pct: number; stale: boolean }> = []
      let total = 0

      for (const pos of positions) {
        const currentPrice = priceMap[pos.symbol]
        const value = pos.quantity * (currentPrice ?? pos.avg_cost)
        const stale = !currentPrice
        total += value
        byType[pos.asset_type] = (byType[pos.asset_type] || 0) + value
        bySector[sectorMap[pos.symbol] ?? 'Unknown'] = (bySector[sectorMap[pos.symbol] ?? 'Unknown'] || 0) + value
        bySymbol.push({ symbol: pos.symbol, value, pct: 0, stale })
      }

      bySymbol.forEach((s) => { s.pct = total > 0 ? (s.value / total) * 100 : 0 })

      return {
        byType: Object.entries(byType).map(([name, value]) => ({
          name,
          value,
          pct: total > 0 ? (value / total) * 100 : 0,
        })),
        bySector: Object.entries(bySector).map(([name, value]) => ({
          name,
          value,
          pct: total > 0 ? (value / total) * 100 : 0,
        })),
        bySymbol: bySymbol.sort((a, b) => b.value - a.value),
        total,
      }
    }
  )
  return success(data)
}
