import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'

export async function POST(req: Request) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  let body
  try { body = await req.json() } catch { return error('Invalid JSON', 400) }

  const { portfolio_id } = body
  if (!portfolio_id) return error('portfolio_id is required', 400)

  const { data, error: dbError } = await supabase.rpc('toggle_portfolio_like', {
    portfolio_id,
  })

  if (dbError) return error(dbError.message, 500)
  return success(data)
}
