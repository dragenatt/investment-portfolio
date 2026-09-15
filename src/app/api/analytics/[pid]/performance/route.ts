import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { withAuditedCache } from '@/lib/cache/with-cache'
import { buildResultMetadata, COMMON_ASSUMPTIONS, type PriceSource } from '@/lib/services/result-metadata'
import { CACHE_KEYS } from '@/lib/cache/redis'
import { getHistory } from '@/lib/services/market'
import { lastStoredDates, mergeRows, topUpStoredHistory } from '@/lib/services/price-history'
import { apiHandler } from '@/lib/api/handler'

type PriceRow = { symbol: string; date: string; close: number }

/**
 * Fetch price history from Supabase, falling back to Yahoo Finance
 * when the price_history table is empty or insufficient.
 */
async function getPriceHistory(
  supabase: ReturnType<typeof createServerSupabase> extends Promise<infer T> ? T : never,
  symbols: string[]
): Promise<{ rows: PriceRow[]; source: PriceSource }> {
  // 1. Try Supabase price_history table first
  const { data: dbHistory } = await supabase
    .from('price_history')
    .select('symbol, date, close')
    .in('symbol', symbols)
    .order('date', { ascending: true })

  if (dbHistory && dbHistory.length >= 10) {
    const added = await topUpStoredHistory(lastStoredDates(dbHistory))
    return { rows: mergeRows(dbHistory, added), source: added.length > 0 ? 'mixed' : 'stored' }
  }

  // 2. Fallback: fetch from Yahoo Finance for each symbol
  const allHistory: PriceRow[] = []

  await Promise.all(
    symbols.map(async (symbol) => {
      try {
        const history = await getHistory(symbol, '1y')
        for (const point of history) {
          if (point.close == null) continue
          const date = new Date(point.date).toISOString().slice(0, 10)
          allHistory.push({ symbol, date, close: point.close })
        }
      } catch {
        // Skip symbols that fail
      }
    })
  )

  return { rows: allHistory.sort((a, b) => a.date.localeCompare(b.date)), source: allHistory.length > 0 ? 'provider' : 'none' }
}

async function getHandler(req: Request, { params }: { params: Promise<{ pid: string }> }) {
  const { pid } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const data = await withAuditedCache(
    `${CACHE_KEYS.ANALYTICS_PERFORMANCE}${user.id}:${pid}`,
    300,
    async () => {
      // Get portfolio positions
      const { data: positions } = await supabase
        .from('positions')
        .select('symbol, quantity, avg_cost')
        .eq('portfolio_id', pid)
        .gt('quantity', 0)

      if (!positions || positions.length === 0) return { positions: [], history: [] }

      // Get price history — tries DB first, falls back to Yahoo Finance
      const symbols = positions.map(p => p.symbol)
      const { rows: history, source } = await getPriceHistory(supabase, symbols)

      return {
        positions,
        history,
        _meta: buildResultMetadata({
          model: 'performance',
          data: { description: 'Posiciones abiertas y sus precios de cierre diarios', symbols, priceSource: source },
          period: { from: history[0]?.date ?? null, to: history[history.length - 1]?.date ?? null, observations: history.length, cadence: '1 dia' },
          assumptions: [COMMON_ASSUMPTIONS.priceReturn, { name: 'Precios', value: 'Tal como se guardaron, sin ajuste por splits en esta vista', source: 'performance route' }],
        }),
      }
    }
  )
  return success(data)
}

export const GET = apiHandler(getHandler)
