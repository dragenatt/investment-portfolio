import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { withCache } from '@/lib/cache/with-cache'
import { CACHE_KEYS } from '@/lib/cache/redis'
import { computeAttribution, SP500_SECTOR_WEIGHTS } from '@/lib/services/attribution'

export async function GET(req: Request, { params }: { params: Promise<{ pid: string }> }) {
  const { pid } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const url = new URL(req.url)
  const period = url.searchParams.get('period') || '1M'

  const data = await withCache(
    `${CACHE_KEYS.ANALYTICS_ATTRIBUTION}${pid}:${period}`,
    3600,
    async () => {
      // Get positions with current prices and sectors
      const { data: positions } = await supabase
        .from('positions')
        .select('symbol, quantity, avg_cost')
        .eq('portfolio_id', pid)
        .gt('quantity', 0)

      if (!positions || positions.length === 0) return null

      const symbols = positions.map((p) => p.symbol)

      const { data: prices } = await supabase
        .from('current_prices')
        .select('symbol, price')
        .in('symbol', symbols)

      const { data: companies } = await supabase
        .from('company_data')
        .select('symbol, sector')
        .in('symbol', symbols)

      const priceMap: Record<string, number> = {}
      for (const p of prices ?? []) priceMap[p.symbol] = p.price

      const sectorMap: Record<string, string> = {}
      for (const c of companies ?? []) sectorMap[c.symbol] = c.sector ?? 'Unknown'

      // Group by sector with returns
      const sectorData: Record<string, { value: number; cost: number }> = {}
      let totalValue = 0

      for (const pos of positions) {
        const price = priceMap[pos.symbol] ?? pos.avg_cost
        const value = pos.quantity * price
        const cost = pos.quantity * pos.avg_cost
        totalValue += value
        const sector = sectorMap[pos.symbol] ?? 'Unknown'
        if (!sectorData[sector]) sectorData[sector] = { value: 0, cost: 0 }
        sectorData[sector].value += value
        sectorData[sector].cost += cost
      }

      const portfolioSectors = Object.entries(sectorData).map(([sector, data]) => ({
        sector,
        weight: totalValue > 0 ? data.value / totalValue : 0,
        return_pct: data.cost > 0 ? ((data.value - data.cost) / data.cost) * 100 : 0,
      }))

      // Get benchmark return for period (simplified)
      const benchmarkReturn = 10 // TODO: calculate from benchmark_prices

      return computeAttribution(portfolioSectors, benchmarkReturn, SP500_SECTOR_WEIGHTS)
    }
  )

  return success(data)
}
