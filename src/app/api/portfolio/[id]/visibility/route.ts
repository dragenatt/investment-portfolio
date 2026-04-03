import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { validate } from '@/lib/api/validate'
import { UpdateVisibilitySchema } from '@/lib/schemas/social'

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  let body
  try { body = await req.json() } catch { return error('Invalid JSON', 400) }
  const result = await validate(UpdateVisibilitySchema, body)
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
    .from('portfolios')
    .update(result.data)
    .eq('id', id)
    .select()
    .single()

  if (dbError) return error(dbError.message, 500)
  return success(data)
}
