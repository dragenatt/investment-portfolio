import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; symbol: string }> }) {
  const { id, symbol } = await params
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

  const { error: dbError } = await supabase
    .from('watchlist_items')
    .delete()
    .eq('watchlist_id', id)
    .eq('symbol', symbol)

  if (dbError) return error(dbError.message, 500)
  return success(null)
}
