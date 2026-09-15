import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { apiHandler } from '@/lib/api/handler'
import { publicDisplayName } from '@/lib/services/discover'

// The public profile, in the shape /profile/[username] reads (PublicProfile in
// use-discover). This returned { profile, public_portfolios_count,
// recent_snapshots }, so the page found no username, fell back to
// profile.email — which no profile has — and threw; and an unknown username
// was a 500 from .single() instead of a 404.

async function getHandler(_req: Request, { params }: { params: Promise<{ username: string }> }) {
  const { username } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('user_id, username, display_name, avatar_url, bio, follower_count, following_count, created_at')
    .eq('username', username)
    .maybeSingle()

  if (profileError) return error(profileError.message, 500)
  if (!profile) return error('Perfil no encontrado', 404)

  const { count: publicPortfolioCount } = await supabase
    .from('portfolios')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', profile.user_id)
    .eq('visibility', 'public')
    .is('deleted_at', null)

  return success({
    id: profile.user_id,
    username: profile.username,
    // Never the email that sign-up leaves in display_name.
    displayName: publicDisplayName(profile.display_name),
    avatarUrl: profile.avatar_url,
    bio: profile.bio || null,
    publicPortfolioCount: publicPortfolioCount ?? 0,
    followerCount: profile.follower_count ?? 0,
    followingCount: profile.following_count ?? 0,
    createdAt: profile.created_at,
  })
}

export const GET = apiHandler(getHandler)
