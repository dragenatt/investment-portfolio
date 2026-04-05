import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'

export async function PATCH(_req: Request, { params }: { params: Promise<{ id: string; aid: string }> }) {
  const { aid } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const { error: dbError } = await supabase
    .from('portfolio_alerts')
    .update({ is_dismissed: true, dismissed_at: new Date().toISOString() })
    .eq('id', aid)

  if (dbError) return error(dbError.message, 500)
  return success({ dismissed: true })
}
