import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; symbol: string }> }) {
  const { id, symbol } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const { error: dbError } = await supabase
    .from('watchlist_items')
    .delete()
    .eq('watchlist_id', id)
    .eq('symbol', decodeURIComponent(symbol))

  if (dbError) return error(dbError.message, 500)
  return success({ deleted: true })
}
