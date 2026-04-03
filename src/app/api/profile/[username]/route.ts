import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'

export async function GET(_req: Request, { params }: { params: Promise<{ username: string }> }) {
  const { username } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  // Fetch public profile
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('*')
    .eq('username', username)
    .single()

  if (profileError) return error(profileError.message, 500)

  // Count public portfolios
  const { count: publicPortfoliosCount } = await supabase
    .from('portfolios')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', profile.user_id)
    .eq('visibility', 'public')

  // Fetch recent public portfolio snapshots
  const { data: recentSnapshots } = await supabase
    .from('portfolio_snapshots')
    .select(`
      *,
      portfolios!inner(user_id, name, visibility)
    `)
    .eq('portfolios.user_id', profile.user_id)
    .eq('portfolios.visibility', 'public')
    .order('created_at', { ascending: false })
    .limit(5)

  return success({
    profile,
    public_portfolios_count: publicPortfoliosCount || 0,
    recent_snapshots: recentSnapshots || [],
  })
}
