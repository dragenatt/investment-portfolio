import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { rateLimit } from '@/lib/api/rate-limit'
import { apiHandler } from '@/lib/api/handler'

async function postHandler(req: Request) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const allowed = await rateLimit(user.id, 'general')
  if (!allowed) return error('Demasiadas solicitudes, intenta más tarde', 429)

  let body
  try { body = await req.json() } catch { return error('Invalid JSON', 400) }

  const { portfolio_id } = body
  if (!portfolio_id) return error('portfolio_id is required', 400)

  // Named as toggle_portfolio_like declares it. `portfolio_id` matched no
  // function, so PostgREST answered "Could not find the function" and every
  // like was a 500 — the third time this exact mismatch has shipped, after
  // get_public_portfolios and search_users. tests/lint/rpc-arguments.test.ts
  // now checks the names against the migrations.
  const { data, error: dbError } = await supabase.rpc('toggle_portfolio_like', {
    target_portfolio_id: portfolio_id,
  })

  if (dbError) return error(dbError.message, 500)
  return success(data)
}

export const POST = apiHandler(postHandler)
