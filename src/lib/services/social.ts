import { type SupabaseClient } from '@supabase/supabase-js'

export type PublicProfileData = {
  id: string
  email: string
  username?: string
  avatar_url?: string
  bio?: string
  portfolioCount: number
  followerCount: number
  followingCount: number
  createdAt: string
}

export type FollowerData = {
  id: string
  email: string
  username?: string
  avatar_url?: string
  followedAt: string
}

export async function getPublicProfile(
  supabase: SupabaseClient,
  username: string
): Promise<{ data: PublicProfileData | null; error: Error | null }> {
  try {
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('id, email, username, avatar_url, bio, created_at')
      .eq('username', username)
      .single()

    if (userError) return { data: null, error: userError }
    if (!userData) return { data: null, error: null }

    // Get portfolio count
    const { count: portfolioCount } = await supabase
      .from('portfolios')
      .select('id', { count: 'exact' })
      .eq('user_id', userData.id)
      .eq('is_public', true)
      .is('deleted_at', null)

    // Get follower count
    const { count: followerCount } = await supabase
      .from('follows')
      .select('id', { count: 'exact' })
      .eq('target_user_id', userData.id)

    // Get following count
    const { count: followingCount } = await supabase
      .from('follows')
      .select('id', { count: 'exact' })
      .eq('user_id', userData.id)

    const profile: PublicProfileData = {
      id: userData.id,
      email: userData.email,
      username: userData.username,
      avatar_url: userData.avatar_url,
      bio: userData.bio,
      portfolioCount: portfolioCount ?? 0,
      followerCount: followerCount ?? 0,
      followingCount: followingCount ?? 0,
      createdAt: userData.created_at
    }

    return { data: profile, error: null }
  } catch (err) {
    return {
      data: null,
      error: err instanceof Error ? err : new Error('Unknown error')
    }
  }
}

export async function getUserFollowers(
  supabase: SupabaseClient,
  userId: string,
  page: number = 1,
  limit: number = 20
): Promise<{ data: FollowerData[]; error: Error | null }> {
  try {
    const offset = (page - 1) * limit

    const { data, error } = await supabase
      .from('follows')
      .select(`
        created_at,
        user_id,
        follower:user_id (
          id, email, username, avatar_url
        )
      `)
      .eq('target_user_id', userId)
      .range(offset, offset + limit - 1)
      .order('created_at', { ascending: false })

    if (error) return { data: [], error }

    const followers: FollowerData[] = (data ?? []).map((follow: any) => ({
      id: follow.follower?.id,
      email: follow.follower?.email,
      username: follow.follower?.username,
      avatar_url: follow.follower?.avatar_url,
      followedAt: follow.created_at
    }))

    return { data: followers, error: null }
  } catch (err) {
    return {
      data: [],
      error: err instanceof Error ? err : new Error('Unknown error')
    }
  }
}

export async function getUserFollowing(
  supabase: SupabaseClient,
  userId: string,
  page: number = 1,
  limit: number = 20
): Promise<{ data: FollowerData[]; error: Error | null }> {
  try {
    const offset = (page - 1) * limit

    const { data, error } = await supabase
      .from('follows')
      .select(`
        created_at,
        target_user_id,
        following:target_user_id (
          id, email, username, avatar_url
        )
      `)
      .eq('user_id', userId)
      .range(offset, offset + limit - 1)
      .order('created_at', { ascending: false })

    if (error) return { data: [], error }

    const following: FollowerData[] = (data ?? []).map((follow: any) => ({
      id: follow.following?.id,
      email: follow.following?.email,
      username: follow.following?.username,
      avatar_url: follow.following?.avatar_url,
      followedAt: follow.created_at
    }))

    return { data: following, error: null }
  } catch (err) {
    return {
      data: [],
      error: err instanceof Error ? err : new Error('Unknown error')
    }
  }
}

export async function isFollowing(
  supabase: SupabaseClient,
  currentUserId: string,
  targetUserId: string
): Promise<{ data: boolean; error: Error | null }> {
  try {
    const { data, error } = await supabase
      .from('follows')
      .select('id')
      .eq('user_id', currentUserId)
      .eq('target_user_id', targetUserId)
      .single()

    if (error && error.code === 'PGRST116') {
      // No row found - not following
      return { data: false, error: null }
    }

    if (error) return { data: false, error }

    return { data: !!data, error: null }
  } catch (err) {
    return {
      data: false,
      error: err instanceof Error ? err : new Error('Unknown error')
    }
  }
}
