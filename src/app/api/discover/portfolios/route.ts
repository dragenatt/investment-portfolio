import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'

export async function GET(req: Request) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const { searchParams } = new URL(req.url)
  const sort = searchParams.get('sort') || 'return_pct'
  const order = searchParams.get('order') || 'desc'
  const filter = searchParams.get('filter')
  const min_positions = searchParams.get('min_positions')
  const page = parseInt(searchParams.get('page') || '1', 10)
  const limit = parseInt(searchParams.get('limit') || '20', 10)

  const { data, error: dbError } = await supabase.rpc('get_public_portfolios', {
    sort,
    order,
    filter: filter || null,
    min_positions: min_positions ? parseInt(min_positions, 10) : null,
    page,
    limit,
  })

  if (dbError) return error(dbError.message, 500)
  return success(data)
}
