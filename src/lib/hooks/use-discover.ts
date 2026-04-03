import useSWR from 'swr'
import { apiFetcher } from '@/lib/api/fetcher'

export type PublicPortfolio = {
  id: string
  name: string
  description?: string
  userId: string
  isPublic: boolean
  returnPercent: number
  allTimeReturn: number
  ytdReturn: number
  value: number
  currency: string
  likeCount: number
  owner: {
    id: string
    email: string
    username?: string
    avatar_url?: string
  }
  createdAt: string
  updatedAt: string
}

export type Ranking = {
  rank: number
  portfolioId: string
  portfolioName: string
  userId: string
  username?: string
  avatar_url?: string
  returnPercent: number
  value: number
  currency: string
  likeCount: number
}

export type Leaderboard = {
  category: string
  period: string
  rankings: Ranking[]
  computedAt: string
}

export type PublicProfile = {
  id: string
  email: string
  username?: string
  avatar_url?: string
  bio?: string
  portfolioCount: number
  followerCount: number
  followingCount: number
  isFollowing?: boolean
  createdAt: string
}

type SortOption = 'return' | 'value' | 'likes' | 'recent'
type OrderOption = 'asc' | 'desc'
type FilterOption = 'all' | 'stocks' | 'crypto' | 'diversified'

export function usePublicPortfolios(
  sort: SortOption = 'recent',
  order: OrderOption = 'desc',
  filter: FilterOption = 'all',
  page: number = 1
) {
  const params = new URLSearchParams({
    sort,
    order,
    filter,
    page: String(page)
  })

  const { data, error, isLoading, mutate } = useSWR<PublicPortfolio[]>(
    `/api/discover/portfolios?${params.toString()}`,
    apiFetcher
  )

  return { portfolios: data ?? [], isLoading, error, mutate }
}

export function useLeaderboard(category: string = 'returns', period: string = '1Y') {
  const { data, error, isLoading, mutate } = useSWR<Leaderboard>(
    `/api/discover/leaderboard?category=${encodeURIComponent(category)}&period=${encodeURIComponent(period)}`,
    apiFetcher
  )

  return {
    rankings: data?.rankings ?? [],
    computedAt: data?.computedAt,
    isLoading,
    error,
    mutate
  }
}

export function usePublicProfile(username: string | null) {
  const { data, error, isLoading, mutate } = useSWR<PublicProfile>(
    username ? `/api/profile/${encodeURIComponent(username)}` : null,
    apiFetcher
  )

  return { profile: data, isLoading, error, mutate }
}
