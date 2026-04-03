import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { withCache } from '@/lib/cache/with-cache'
import { CACHE_KEYS } from '@/lib/cache/redis'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const { symbol } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const events = await withCache(
    `${CACHE_KEYS.MARKET_EVENTS}${symbol.toUpperCase()}`,
    1800, // 30 minutes
    async () => {
      const { data: eventsData } = await supabase
        .from('market_events')
        .select('*')
        .eq('symbol', symbol.toUpperCase())
        .gte('event_date', new Date().toISOString().slice(0, 10))
        .order('event_date', { ascending: true })
        .limit(10)

      return eventsData ?? []
    }
  )

  return success(events)
}
