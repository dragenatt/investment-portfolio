import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { validate } from '@/lib/api/validate'
import { AddWatchlistItemSchema } from '@/lib/schemas/watchlist'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  // Verify ownership of watchlist
  const { data: watchlist, error: getError } = await supabase
    .from('watchlists')
    .select('user_id')
    .eq('id', id)
    .single()

  if (getError || !watchlist) return error('Watchlist not found', 404)
  if (watchlist.user_id !== user.id) return error('Forbidden', 403)

  let body
  try { body = await req.json() } catch { return error('Invalid JSON', 400) }
  const result = await validate(AddWatchlistItemSchema, body)
  if ('error' in result) return result.error

  const { data, error: dbError } = await supabase
    .from('watchlist_items')
    .insert({
      watchlist_id: id,
      symbol: result.data.symbol,
      asset_type: result.data.asset_type,
    })
    .select()
    .single()

  if (dbError) return error(dbError.message, 500)
  return success(data, undefined, 201)
}
