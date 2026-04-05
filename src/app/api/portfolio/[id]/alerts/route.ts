import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const { data } = await supabase
    .from('portfolio_alerts')
    .select('*')
    .eq('portfolio_id', id)
    .eq('is_dismissed', false)
    .order('severity', { ascending: true })
    .order('created_at', { ascending: false })

  return success(data ?? [])
}
