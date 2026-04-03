import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { validate } from '@/lib/api/validate'
import { SharePortfolioSchema } from '@/lib/schemas/social'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  // Verify ownership
  const { data: portfolio, error: fetchError } = await supabase
    .from('portfolios')
    .select('user_id')
    .eq('id', id)
    .single()

  if (fetchError) return error(fetchError.message, 500)
  if (portfolio.user_id !== user.id) return error('Forbidden', 403)

  const { data, error: dbError } = await supabase
    .from('portfolio_shares')
    .select('*')
    .eq('portfolio_id', id)
    .order('created_at', { ascending: false })

  if (dbError) return error(dbError.message, 500)
  return success(data)
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  let body
  try { body = await req.json() } catch { return error('Invalid JSON', 400) }
  const result = await validate(SharePortfolioSchema, body)
  if ('error' in result) return result.error

  // Verify ownership
  const { data: portfolio, error: fetchError } = await supabase
    .from('portfolios')
    .select('user_id')
    .eq('id', id)
    .single()

  if (fetchError) return error(fetchError.message, 500)
  if (portfolio.user_id !== user.id) return error('Forbidden', 403)

  const { data, error: dbError } = await supabase
    .from('portfolio_shares')
    .insert({
      portfolio_id: id,
      ...result.data,
    })
    .select()
    .single()

  if (dbError) return error(dbError.message, 500)
  return success(data, undefined, 201)
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const { searchParams } = new URL(req.url)
  const share_id = searchParams.get('share_id')
  if (!share_id) return error('share_id query parameter is required', 400)

  // Verify ownership
  const { data: portfolio, error: fetchError } = await supabase
    .from('portfolios')
    .select('user_id')
    .eq('id', id)
    .single()

  if (fetchError) return error(fetchError.message, 500)
  if (portfolio.user_id !== user.id) return error('Forbidden', 403)

  const { error: dbError } = await supabase
    .from('portfolio_shares')
    .delete()
    .eq('id', share_id)

  if (dbError) return error(dbError.message, 500)
  return success({ deleted: true })
}
