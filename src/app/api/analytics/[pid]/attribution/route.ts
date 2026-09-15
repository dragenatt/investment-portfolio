import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { withAuditedCache } from '@/lib/cache/with-cache'
import { buildResultMetadata } from '@/lib/services/result-metadata'
import { CACHE_KEYS } from '@/lib/cache/redis'
import {
  computeAttribution,
  contributionByAsset,
  SP500_SECTOR_WEIGHTS,
} from '@/lib/services/attribution'
import { getBatchQuotes } from '@/lib/services/market'
import { apiHandler } from '@/lib/api/handler'

async function getHandler(req: Request, { params }: { params: Promise<{ pid: string }> }) {
  const { pid } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const url = new URL(req.url)
  const period = url.searchParams.get('period') || '1M'

  const data = await withAuditedCache(
    `${CACHE_KEYS.ANALYTICS_ATTRIBUTION}${user.id}:${pid}:${period}`,
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
      const perPosition: Array<{ symbol: string; sector: string; value: number; cost: number }> = []
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
        perPosition.push({ symbol: pos.symbol, sector, value, cost })
      }

      const portfolioSectors = Object.entries(sectorData).map(([sector, data]) => ({
        sector,
        weight: totalValue > 0 ? data.value / totalValue : 0,
        return_pct: data.cost > 0 ? ((data.value - data.cost) / data.cost) * 100 : 0,
      }))

      // Calculate overall portfolio return as benchmark comparison
      const totalCost = positions.reduce((sum, pos) => sum + pos.quantity * pos.avg_cost, 0)
      const benchmarkReturn = totalCost > 0 ? ((totalValue - totalCost) / totalCost) * 100 : 0

      // Which holdings produced the number at the top of the page. Weight times
      // return, so the parts add up to the whole — a 40% gain on 2% of the book
      // contributes less than a 3% gain on half of it, and ranking by return
      // alone never shows that.
      const contribution = contributionByAsset(
        perPosition.map((p) => ({
          symbol: p.symbol,
          sector: p.sector,
          weight: totalValue > 0 ? p.value / totalValue : 0,
          returnPct: p.cost > 0 ? ((p.value - p.cost) / p.cost) * 100 : 0,
          unrealizedPnl: p.value - p.cost,
        })),
      )

      return {
        ...computeAttribution(portfolioSectors, benchmarkReturn, SP500_SECTOR_WEIGHTS),
        contribution,
        _meta: buildResultMetadata({
          model: 'attribution',
          data: {
            description: 'Posiciones actuales valuadas a su última cotización guardada, completadas con cotizaciones en vivo; sectores de los datos de empresas',
            symbols,
            excluded: symbols.filter((s) => !priceMap[s]),
            priceSource: missingPrices.length > 0 ? 'mixed' : 'stored',
          },
          assumptions: [
            { name: 'Pesos sectoriales del índice', value: 'S&P 500 aproximados, fijos en el código', source: 'attribution.ts (SP500_SECTOR_WEIGHTS)' },
            { name: 'Rendimiento', value: 'No realizado sobre costo promedio', source: 'attribution route' },
            { name: 'Sin cotización', value: 'Se usa el costo promedio', source: 'attribution route' },
          ],
          benchmark: { symbol: '^GSPC', name: 'S&P 500 (pesos sectoriales)' },
        }),
      }
    }
  )

  return success(data)
}

export const GET = apiHandler(getHandler)
