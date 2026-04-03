import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { withCache } from '@/lib/cache/with-cache'
import { CACHE_KEYS } from '@/lib/cache/redis'

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

      // Get price history for all symbols
      const symbols = positions.map(p => p.symbol)
      const { data: history } = await supabase
        .from('price_history')
        .select('symbol, date, close')
        .in('symbol', symbols)
        .order('date', { ascending: true })

      return { positions, history: history || [] }
    }
  )
  return success(data)
}
