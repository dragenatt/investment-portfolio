import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { validate } from '@/lib/api/validate'
import { UpdateAlertSchema } from '@/lib/schemas/alert'

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const body = await req.json()
  const result = await validate(UpdateAlertSchema, body)
  if ('error' in result) return result.error

  const { data, error: dbError } = await supabase
    .from('alerts')
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

  const { error: dbError } = await supabase.from('alerts').delete().eq('id', id)
  if (dbError) return error(dbError.message, 500)
  return success({ deleted: true })
}
