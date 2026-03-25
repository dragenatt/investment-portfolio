import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'

export async function POST(req: Request) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const body = await req.json()
  const { events } = body

  if (!Array.isArray(events) || events.length === 0) return error('events array required', 400)

  const expires_at = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString()

  const rows = events.map((e: Record<string, unknown>) => ({
    symbol: (e.symbol as string).toUpperCase(),
    event_type: e.event_type,
    event_date: e.event_date,
    title: e.title || '',
    description: e.description || '',
    fetched_at: new Date().toISOString(),
    expires_at,
  }))

  const { data, error: dbError } = await supabase
    .from('market_events')
    .upsert(rows, { onConflict: 'symbol,event_type,event_date' })
    .select()

  if (dbError) return error(dbError.message, 500)
  return success(data)
}
