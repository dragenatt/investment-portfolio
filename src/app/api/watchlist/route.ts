import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { validate } from '@/lib/api/validate'
import { CreateWatchlistSchema } from '@/lib/schemas/watchlist'

export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const { data, error: dbError } = await supabase
    .from('watchlists')
    .select('*, watchlist_items(*)')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (dbError) return error(dbError.message, 500)
  return success(data)
}

export async function POST(req: Request) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const body = await req.json()
  const result = await validate(CreateWatchlistSchema, body)
  if ('error' in result) return result.error

  const { data, error: dbError } = await supabase
    .from('watchlists')
    .insert({ ...result.data, user_id: user.id })
    .select()
    .single()

  if (dbError) return error(dbError.message, 500)
  return success(data, undefined, 201)
}
