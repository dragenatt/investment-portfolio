import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { validate } from '@/lib/api/validate'
import { AddWatchlistItemSchema } from '@/lib/schemas/watchlist'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const body = await req.json()
  const result = await validate(AddWatchlistItemSchema, body)
  if ('error' in result) return result.error

  const { data, error: dbError } = await supabase
    .from('watchlist_items')
    .insert({ ...result.data, watchlist_id: id })
    .select()
    .single()

  if (dbError) return error(dbError.message, 500)
  return success(data, undefined, 201)
}
