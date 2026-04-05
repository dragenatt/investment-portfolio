import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'

export async function GET(req: Request) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const url = new URL(req.url)
  const category = url.searchParams.get('category') || 'return'
  const period = url.searchParams.get('period') || '1M'
  const days = parseInt(url.searchParams.get('days') || '30')

  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - days)

  const { data } = await supabase
    .from('leaderboard_history')
    .select('snapshot_date, rankings')
    .eq('category', category)
    .eq('period', period)
    .gte('snapshot_date', cutoff.toISOString().split('T')[0])
    .order('snapshot_date', { ascending: true })

  return success(data ?? [])
}
