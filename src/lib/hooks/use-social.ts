import useSWR from 'swr'
import { useState, useCallback } from 'react'
import { apiFetcher } from '@/lib/api/fetcher'
import { useDebounce } from './use-debounce'

export type Activity = {
  id: string
  userId: string
  type: 'follow' | 'portfolio_created' | 'portfolio_updated' | 'like' | 'comment'
  portfolioId?: string
  targetUserId?: string
  createdAt: string
  user: {
    id: string
    email: string
    username?: string
    avatar_url?: string
  }
}

export type UserSearchResult = {
  id: string
  email: string
  username?: string
  avatar_url?: string
  isFollowing?: boolean
  followerCount: number
}

export function useFollow(userId: string) {
  const [isFollowing, setIsFollowing] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const toggle = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/social/follow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_user_id: userId })
      })
      const json = await res.json()
      if (json.error) throw new Error(json.error)
      setIsFollowing(json.data.isFollowing)
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'))
    } finally {
      setIsLoading(false)
    }
  }, [userId])

  return { isFollowing, toggle, isLoading, error }
}

export function useLike(portfolioId: string) {
  const [isLiked, setIsLiked] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const toggle = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/social/like', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ portfolio_id: portfolioId })
      })
      const json = await res.json()
      if (json.error) throw new Error(json.error)
      setIsLiked(json.data.isLiked)
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'))
    } finally {
      setIsLoading(false)
    }
  }, [portfolioId])

  return { isLiked, toggle, isLoading, error }
}

export function useActivityFeed(page: number = 1) {
  const { data, error, isLoading, mutate } = useSWR<Activity[]>(
    `/api/social/feed?page=${page}`,
    apiFetcher
  )

  return { activities: data ?? [], error, isLoading, mutate }
}

export function useSearchUsers(query: string) {
  const debouncedQuery = useDebounce(query, 300)
  
  const { data, error, isLoading } = useSWR<UserSearchResult[]>(
    debouncedQuery ? `/api/social/search?q=${encodeURIComponent(debouncedQuery)}` : null,
    apiFetcher
  )

  return { users: data ?? [], isLoading, error }
}
