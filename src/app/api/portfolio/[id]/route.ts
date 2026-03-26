import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { validate } from '@/lib/api/validate'
import { UpdatePortfolioSchema } from '@/lib/schemas/portfolio'
import { getPortfolioDetail } from '@/lib/services/portfolio'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const { data, error: dbError } = await getPortfolioDetail(supabase, id)
  if (dbError) return error(dbError.message, dbError.code === 'PGRST116' ? 404 : 500)

  return success(data)
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  let body
  try { body = await req.json() } catch { return error('Invalid JSON', 400) }
  const result = await validate(UpdatePortfolioSchema, body)
  if ('error' in result) return result.error

  const { data, error: dbError } = await supabase
    .from('portfolios')
    .update(result.data)
    .eq('id', id)
    .select()
    .single()

  if (dbError) return error(dbError.message, 500)
  return success(data)
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const { error: dbError } = await supabase
    .from('portfolios')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)

  if (dbError) return error(dbError.message, 500)
  return success({ deleted: true })
}
