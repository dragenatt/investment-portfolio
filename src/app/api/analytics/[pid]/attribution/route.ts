import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { withCache } from '@/lib/cache/with-cache'
import { CACHE_KEYS } from '@/lib/cache/redis'
import { computeAttribution, SP500_SECTOR_WEIGHTS } from '@/lib/services/attribution'
import { getBatchQuotes } from '@/lib/services/market'

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
      // Get positions with asset type
      const { data: positions } = await supabase
        .from('positions')
        .select('symbol, quantity, avg_cost, asset_type')
        .eq('portfolio_id', pid)
        .gt('quantity', 0)

      if (!positions || positions.length === 0) return null

      const symbols = positions.map((p) => p.symbol)

      // Get current prices — try DB first, fall back to Yahoo
      const { data: dbPrices } = await supabase
        .from('current_prices')
        .select('symbol, price')
        .in('symbol', symbols)

      const priceMap: Record<string, number> = {}
      for (const p of dbPrices ?? []) priceMap[p.symbol] = p.price

      // If DB has few prices, fetch from Yahoo/market service
      const missingPrices = symbols.filter(s => !priceMap[s])
      if (missingPrices.length > 0) {
        try {
          const liveQuotes = await getBatchQuotes(missingPrices)
          for (const [sym, quote] of Object.entries(liveQuotes)) {
            if (quote.price != null) priceMap[sym] = quote.price
          }
        } catch {
          // Fall through to avg_cost fallback below
        }
      }

      // Get sector data from company_data table
      const { data: companies } = await supabase
        .from('company_data')
        .select('symbol, sector')
        .in('symbol', symbols)

      const sectorMap: Record<string, string> = {}
      for (const c of companies ?? []) {
        if (c.sector) sectorMap[c.symbol] = c.sector
      }

      // Group by sector with returns
      // Fall back to asset_type if company_data has no sector
      const sectorData: Record<string, { value: number; cost: number }> = {}
      let totalValue = 0

      for (const pos of positions) {
        const price = priceMap[pos.symbol] ?? pos.avg_cost
        const value = pos.quantity * price
        const cost = pos.quantity * pos.avg_cost
        totalValue += value

        // Use company sector, fall back to capitalized asset_type, then "Other"
        const sector = sectorMap[pos.symbol]
          || (pos.asset_type ? pos.asset_type.charAt(0).toUpperCase() + pos.asset_type.slice(1) : 'Other')

        if (!sectorData[sector]) sectorData[sector] = { value: 0, cost: 0 }
        sectorData[sector].value += value
        sectorData[sector].cost += cost
      }

      const portfolioSectors = Object.entries(sectorData).map(([sector, data]) => ({
        sector,
        weight: totalValue > 0 ? data.value / totalValue : 0,
        return_pct: data.cost > 0 ? ((data.value - data.cost) / data.cost) * 100 : 0,
      }))

      // Calculate overall portfolio return as benchmark comparison
      const totalCost = positions.reduce((sum, pos) => sum + pos.quantity * pos.avg_cost, 0)
      const benchmarkReturn = totalCost > 0 ? ((totalValue - totalCost) / totalCost) * 100 : 0

      return computeAttribution(portfolioSectors, benchmarkReturn, SP500_SECTOR_WEIGHTS)
    }
  )

  return success(data)
}
