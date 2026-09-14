import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { apiHandler } from '@/lib/api/handler'
import { validate } from '@/lib/api/validate'
import { RenameWatchlistSchema } from '@/lib/schemas/watchlist-manage'

async function getHandler(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const { data, error: dbError } = await supabase
    .from('watchlists')
    .select('*, watchlist_items(*)')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (dbError) return error(dbError.message, 500)
  if (!data) return error('Watchlist not found', 404)
  return success(data)
}

async function patchHandler(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  let body
  try { body = await req.json() } catch { return error('Invalid JSON', 400) }
  // The body went straight into .update(): any column the table has was
  // writable through this route (C6). Only the name is.
  const parsed = await validate(RenameWatchlistSchema, body)
  if ('error' in parsed) return parsed.error

  // Verify ownership
  const { data: watchlist, error: getError } = await supabase
    .from('watchlists')
    .select('user_id')
    .eq('id', id)
    .single()

  if (getError || !watchlist) return error('Watchlist not found', 404)
  if (watchlist.user_id !== user.id) return error('Forbidden', 403)

  const { data, error: dbError } = await supabase
    .from('watchlists')
    .update(parsed.data)
    .eq('id', id)
    .select('*, watchlist_items(*)')
    .single()

  if (dbError) return error(dbError.message, 500)
  return success(data)
}

async function deleteHandler(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  // Verify ownership
  const { data: watchlist, error: getError } = await supabase
    .from('watchlists')
    .select('user_id')
    .eq('id', id)
    .single()

  if (getError || !watchlist) return error('Watchlist not found', 404)
  if (watchlist.user_id !== user.id) return error('Forbidden', 403)

  const { error: dbError } = await supabase
    .from('watchlists')
    .delete()
    .eq('id', id)

  if (dbError) return error(dbError.message, 500)
  return success(null)
}

export const GET = apiHandler(getHandler)
export const PATCH = apiHandler(patchHandler)
export const DELETE = apiHandler(deleteHandler)
