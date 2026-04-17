import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { withCache } from '@/lib/cache/with-cache'
import { CACHE_KEYS } from '@/lib/cache/redis'
import { getHistory } from '@/lib/services/market'

type PriceRow = { symbol: string; date: string; close: number }

/**
 * Fetch price history from Supabase, falling back to Yahoo Finance
 * when the price_history table is empty or insufficient.
 */
async function getPriceHistory(
  supabase: ReturnType<typeof createServerSupabase> extends Promise<infer T> ? T : never,
  symbols: string[]
): Promise<PriceRow[]> {
  // 1. Try Supabase price_history table first
  const { data: dbHistory } = await supabase
    .from('price_history')
    .select('symbol, date, close')
    .in('symbol', symbols)
    .order('date', { ascending: true })

  if (dbHistory && dbHistory.length >= 10) {
    return dbHistory
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

  return allHistory.sort((a, b) => a.date.localeCompare(b.date))
}

export async function GET(req: Request, { params }: { params: Promise<{ pid: string }> }) {
  const { pid } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const data = await withCache(
    `${CACHE_KEYS.ANALYTICS_PERFORMANCE}${pid}`,
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
      const history = await getPriceHistory(supabase, symbols)

      return { positions, history }
    }
  )
  return success(data)
}
