import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { validate } from '@/lib/api/validate'
import { RenameWatchlistSchema } from '@/lib/schemas/watchlist-manage'

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const { data: wl } = await supabase
    .from('watchlists')
    .select('id')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()
  if (!wl) return error('Watchlist not found', 404)

  await supabase.from('watchlist_items').delete().eq('watchlist_id', id)
  const { error: delErr } = await supabase.from('watchlists').delete().eq('id', id)
  if (delErr) return error(delErr.message, 500)

  return success({ deleted: true })
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const body = await req.json()
  const result = await validate(RenameWatchlistSchema, body)
  if ('error' in result) return result.error

  const { error: updateErr } = await supabase
    .from('watchlists')
    .update({ name: result.data.name })
    .eq('id', id)
    .eq('user_id', user.id)
  if (updateErr) return error(updateErr.message, 500)

  return success({ updated: true })
}
