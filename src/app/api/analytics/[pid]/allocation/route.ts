import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { withAuditedCache } from '@/lib/cache/with-cache'
import { buildResultMetadata } from '@/lib/services/result-metadata'
import { summariseAllocation, type StoredQuote } from '@/lib/services/allocation-breakdown'
import { CACHE_KEYS } from '@/lib/cache/redis'
import { apiHandler } from '@/lib/api/handler'
import { valueBookInBase } from '@/lib/services/book-valuation'

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
        return { byType: [], bySector: [], bySymbol: [], total: 0, currency: null, unconverted: [] }
      }

      // Get current prices for all position symbols
      const symbols = positions.map((p) => p.symbol)
      const { data: prices } = await supabase
        .from('current_prices')
        .select('symbol, price, fetched_at')
        .in('symbol', symbols)

      // The fetch time comes along so each holding's freshness is classified by
      // freshness.ts, not decided here. Ages are measured when this result is
      // computed, and it is cached for five minutes, so a label can trail the
      // clock by at most that much.
      const quoteMap: Record<string, StoredQuote> = {}
      for (const p of prices ?? []) {
        quoteMap[p.symbol] = { price: p.price, fetched_at: p.fetched_at }
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

      // Valued at the last stored quote, falling back to the average cost, each
      // in the portfolio's currency at today's rate: quantity × quote added a
      // peso holding to a dollar one as one unit, so a mixed book's shares were
      // wrong and every total was in no currency at all.
      // The shaping itself lives in summariseAllocation so a test can hold the
      // field names the interface reads.
      const { data: portfolio } = await supabase.from('portfolios').select('base_currency').eq('id', pid).maybeSingle()
      const quotes = Object.fromEntries(Object.entries(quoteMap).map(([symbol, quote]) => [symbol, Number(quote.price)]))
      const valuation = await valueBookInBase(supabase, positions, quotes, String(portfolio?.base_currency ?? 'USD'))
      const breakdown = summariseAllocation(positions, quoteMap, sectorMap, new Date(), valuation.values)

      return {
        ...breakdown,
        /** The currency every value is in: the portfolio's. */
        currency: valuation.base,
        unconverted: valuation.unconverted,
        _meta: buildResultMetadata({
          model: 'allocation',
          data: {
            description: 'Posiciones actuales valuadas a su última cotización guardada',
            symbols,
            excluded: symbols.filter((s) => !quoteMap[s]),
            priceSource: 'stored',
          },
          assumptions: [
            { name: 'Sin cotización', value: 'Se usa el costo promedio y la posición se marca «Sin precio»', source: 'freshness.ts' },
            { name: 'Frescura', value: 'Al día hasta 15 min; con retraso hasta 24 h; después, precio guardado', source: 'freshness.ts' },
            { name: 'Moneda', value: `Valores en ${valuation.base} al tipo de cambio de hoy`, source: 'book-valuation.ts' },
          ],
        }),
      }
    }
  )
  return success(data)
}

export const GET = apiHandler(getHandler)
