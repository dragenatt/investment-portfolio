import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { withAuditedCache } from '@/lib/cache/with-cache'
import { buildResultMetadata } from '@/lib/services/result-metadata'
import { summariseAllocation } from '@/lib/services/allocation-breakdown'
import { CACHE_KEYS } from '@/lib/cache/redis'
import { apiHandler } from '@/lib/api/handler'

async function getHandler(_req: Request, { params }: { params: Promise<{ pid: string }> }) {
  const { pid } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const data = await withAuditedCache(
    `${CACHE_KEYS.ANALYTICS_ALLOCATION}${user.id}:${pid}`,
    300,
    async () => {
      // Get positions
      const { data: positions } = await supabase
        .from('positions')
        .select('symbol, asset_type, quantity, avg_cost, currency')
        .eq('portfolio_id', pid)
        .gt('quantity', 0)

      // Every breakdown, empty: omitting bySector here made "no sectors" and
      // "sectors were not computed" look the same to the reader.
      if (!positions || positions.length === 0) {
        return { byType: [], bySector: [], bySymbol: [], total: 0 }
      }

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

      // Valued at the last stored quote, falling back to the average cost.
      // The shaping itself lives in summariseAllocation so a test can hold the
      // field names the interface reads.
      const breakdown = summariseAllocation(positions, priceMap, sectorMap)

      return {
        ...breakdown,
        _meta: buildResultMetadata({
          model: 'allocation',
          data: {
            description: 'Posiciones actuales valuadas a su última cotización guardada',
            symbols,
            excluded: symbols.filter((s) => !priceMap[s]),
            priceSource: 'stored',
          },
          assumptions: [{ name: 'Sin cotización', value: 'Se usa el costo promedio y la posición se marca como desactualizada', source: 'allocation route' }],
        }),
      }
    }
  )
  return success(data)
}

export const GET = apiHandler(getHandler)
