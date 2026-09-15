import useSWR from 'swr'
import { apiFetcher } from '@/lib/api/fetcher'
import type { DiscoverSort, PublicPortfolio, Ranking } from '@/lib/services/discover'

export type { PublicPortfolio, Ranking } from '@/lib/services/discover'

export type Leaderboard = {
  category: string
  period: string
  rankings: Ranking[]
  computedAt: string | null
}

export type PublicProfile = {
  /** The user's id, as follows and portfolios reference it. */
  id: string
  username: string | null
  displayName: string | null
  avatarUrl: string | null
  bio: string | null
  publicPortfolioCount: number
  followerCount: number
  followingCount: number
  createdAt: string
}

type SortOption = DiscoverSort
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

export function useLeaderboard(category: string = 'returns') {
  const { data, error, isLoading, mutate } = useSWR<Leaderboard>(
    `/api/discover/leaderboard?category=${encodeURIComponent(category)}`,
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
