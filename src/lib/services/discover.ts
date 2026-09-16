import { TRADING_DAYS_PER_YEAR } from '@/lib/constants/financial-constants'
// Discover and leaderboard — the contracts between the database and the pages,
// as pure functions.
//
// Every layer of this feature had been written against a different idea of the
// others: the route called get_public_portfolios with parameter names the
// function does not have (47 errors in error_events), the pages read fields no
// route returned, and the nightly leaderboard wrote per-portfolio columns that
// leaderboard_cache does not have, through an embed PostgREST cannot resolve.
// These functions are the single place where each shape is translated.

// ─── Public portfolios (get_public_portfolios) ──────────────────────────────

export const DISCOVER_SORTS = ['recent', 'return', 'likes'] as const
export type DiscoverSort = (typeof DISCOVER_SORTS)[number]

/** The page's sort names, mapped to the ones the SQL function's ORDER BY knows. */
const SORT_TO_RPC: Record<DiscoverSort, string> = {
  recent: 'newest',
  return: 'return_pct',
  likes: 'likes',
}

export const DISCOVER_PAGE_SIZE_MAX = 50

export type PublicPortfolioArgs = {
  sort_by: string
  sort_order: 'asc' | 'desc'
  asset_filter: string | null
  min_positions: number
  page_num: number
  page_size: number
}

function positiveInt(value: string | null, fallback: number, max = Number.MAX_SAFE_INTEGER): number {
  const n = Number.parseInt(value ?? '', 10)
  if (!Number.isFinite(n) || n < 1) return fallback
  return Math.min(n, max)
}

/**
 * Arguments for get_public_portfolios, named as the function declares them.
 *
 * min_positions is never null: the function compares `>= min_positions`, and
 * a null there filters out every row.
 */
export function publicPortfolioArgs(params: URLSearchParams): PublicPortfolioArgs {
  const sort = params.get('sort')
  const filter = params.get('filter')
  const minPositions = Number.parseInt(params.get('min_positions') ?? '', 10)
  return {
    sort_by: SORT_TO_RPC[(DISCOVER_SORTS as readonly string[]).includes(sort ?? '') ? (sort as DiscoverSort) : 'recent'],
    sort_order: params.get('order') === 'asc' ? 'asc' : 'desc',
    asset_filter: filter && filter !== 'all' ? filter : null,
    min_positions: Number.isFinite(minPositions) && minPositions > 0 ? minPositions : 0,
    page_num: positiveInt(params.get('page'), 1),
    page_size: positiveInt(params.get('limit'), 20, DISCOVER_PAGE_SIZE_MAX),
  }
}

/** A row of get_public_portfolios. */
export type PublicPortfolioRow = {
  portfolio_id: string
  portfolio_name: string
  owner_user_id: string
  username: string | null
  display_name: string | null
  avatar_url: string | null
  total_return_pct: number | string | null
  sharpe_ratio: number | string | null
  volatility: number | string | null
  position_count: number | null
  like_count: number | null
  view_count: number | null
  tags: string[] | null
  snapshot_date: string | null
}

export type PublicPortfolio = {
  id: string
  name: string
  userId: string
  /** From the latest nightly snapshot; null until the portfolio has one. */
  returnPercent: number | null
  sharpeRatio: number | null
  positionCount: number | null
  likeCount: number
  tags: string[]
  snapshotDate: string | null
  owner: { id: string; username: string | null; displayName: string | null; avatarUrl: string | null }
}

/**
 * A display name fit to show other users, or null.
 *
 * Sign-up fills display_name with the account's email when no name is given,
 * so for many people the "name" is their email address. Public pages must not
 * show it; the username stands in.
 */
export function publicDisplayName(name: string | null | undefined): string | null {
  const trimmed = name?.trim()
  if (!trimmed || trimmed.includes('@')) return null
  return trimmed
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

export function toPublicPortfolio(row: PublicPortfolioRow): PublicPortfolio {
  return {
    id: row.portfolio_id,
    name: row.portfolio_name,
    userId: row.owner_user_id,
    returnPercent: toNumber(row.total_return_pct),
    sharpeRatio: toNumber(row.sharpe_ratio),
    positionCount: toNumber(row.position_count),
    likeCount: toNumber(row.like_count) ?? 0,
    tags: row.tags ?? [],
    snapshotDate: row.snapshot_date,
    owner: {
      id: row.owner_user_id,
      username: row.username,
      displayName: publicDisplayName(row.display_name),
      avatarUrl: row.avatar_url,
    },
  }
}

// ─── User search (search_users) ─────────────────────────────────────────────

export type UserSearchRow = {
  user_id: string
  username: string | null
  display_name: string | null
  avatar_url: string | null
  follower_count: number | null
}

export type UserSearchResult = {
  id: string
  username: string
  displayName: string | null
  avatarUrl: string | null
  followerCount: number
}

export const USER_SEARCH_LIMIT = 20

/**
 * Whether a search may run. search_users also matches display_name, which for
 * many accounts is still the sign-up email; a query with an @ would let anyone
 * confirm that an address has an account.
 */
export function isSearchableQuery(query: string | null): query is string {
  const trimmed = query?.trim() ?? ''
  return trimmed.length >= 2 && !trimmed.includes('@')
}

export function toUserSearchResults(rows: UserSearchRow[]): UserSearchResult[] {
  return rows
    .filter((row): row is UserSearchRow & { username: string } => !!row.username)
    .map((row) => ({
      id: row.user_id,
      username: row.username,
      displayName: publicDisplayName(row.display_name),
      avatarUrl: row.avatar_url,
      followerCount: toNumber(row.follower_count) ?? 0,
    }))
}

// ─── Leaderboard ────────────────────────────────────────────────────────────

/**
 * The only period there is: snapshots carry each portfolio's metrics since it
 * began, and nothing in them isolates a month or a year. The page offered
 * 1M/3M/1Y and every one read the same missing row.
 */
export const LEADERBOARD_PERIOD = 'ALL'

export const LEADERBOARD_CATEGORIES = ['returns', 'sharpe', 'volatility', 'consistency'] as const
export type LeaderboardCategory = (typeof LEADERBOARD_CATEGORIES)[number]

export function isLeaderboardCategory(value: string): value is LeaderboardCategory {
  return (LEADERBOARD_CATEGORIES as readonly string[]).includes(value)
}

export const LEADERBOARD_SIZE = 50

/** What the nightly snapshot knows about a public portfolio. */
export type LeaderboardSnapshot = {
  portfolio_id: string
  portfolio_name: string
  user_id: string
  like_count: number | null
  total_value: number | string | null
  total_return_pct: number | string | null
  sharpe_ratio: number | string | null
  /** Standard deviation of daily returns, a fraction. */
  volatility: number | string | null
  /** Share of positive days, a fraction. */
  win_rate: number | string | null
}

export type LeaderboardProfile = {
  user_id: string
  username: string | null
  display_name: string | null
  avatar_url: string | null
}

/**
 * One row of a leaderboard. No money amounts: a public portfolio may hide them
 * (show_amounts), and a ranking is not the place to decide otherwise.
 */
export type Ranking = {
  rank: number
  portfolioId: string
  portfolioName: string
  userId: string
  username: string | null
  displayName: string | null
  avatarUrl: string | null
  likeCount: number
  /** Total return since the portfolio began, %. */
  returnPercent: number | null
  sharpeRatio: number | null
  /** Annualised volatility, %. */
  volatilityPct: number | null
  /** Share of positive days, %. */
  winRatePct: number | null
}


type CategoryRule = { metric: (r: Ranking) => number | null; order: 'asc' | 'desc' }

const CATEGORY_RULES: Record<LeaderboardCategory, CategoryRule> = {
  returns: { metric: (r) => r.returnPercent, order: 'desc' },
  sharpe: { metric: (r) => r.sharpeRatio, order: 'desc' },
  volatility: { metric: (r) => r.volatilityPct, order: 'asc' },
  consistency: { metric: (r) => r.winRatePct, order: 'desc' },
}

/**
 * Every category's ranking from the night's snapshots.
 *
 * A portfolio without the category's metric is left out of that category
 * rather than ranked as zero: Sharpe, volatility and win rate need five nights
 * of snapshots, and a new portfolio would otherwise top "lowest volatility".
 * Ties keep a stable order by name.
 */
export function buildLeaderboards(
  snapshots: LeaderboardSnapshot[],
  profiles: LeaderboardProfile[],
): Record<LeaderboardCategory, Ranking[]> {
  const profileByUser = new Map(profiles.map((p) => [p.user_id, p]))
  const entries: Array<Omit<Ranking, 'rank'>> = snapshots
    .filter((s) => (toNumber(s.total_value) ?? 0) > 0)
    .map((s) => {
      const profile = profileByUser.get(s.user_id)
      const volatility = toNumber(s.volatility)
      const winRate = toNumber(s.win_rate)
      return {
        portfolioId: s.portfolio_id,
        portfolioName: s.portfolio_name,
        userId: s.user_id,
        username: profile?.username ?? null,
        displayName: publicDisplayName(profile?.display_name),
        avatarUrl: profile?.avatar_url ?? null,
        likeCount: toNumber(s.like_count) ?? 0,
        returnPercent: toNumber(s.total_return_pct),
        sharpeRatio: toNumber(s.sharpe_ratio),
        volatilityPct: volatility === null ? null : volatility * Math.sqrt(TRADING_DAYS_PER_YEAR) * 100,
        winRatePct: winRate === null ? null : winRate * 100,
      }
    })

  const boards = {} as Record<LeaderboardCategory, Ranking[]>
  for (const category of LEADERBOARD_CATEGORIES) {
    const rule = CATEGORY_RULES[category]
    boards[category] = entries
      .filter((e) => rule.metric(e as Ranking) !== null)
      .sort((a, b) => {
        const diff = rule.metric(a as Ranking)! - rule.metric(b as Ranking)!
        return (rule.order === 'asc' ? diff : -diff) || a.portfolioName.localeCompare(b.portfolioName)
      })
      .slice(0, LEADERBOARD_SIZE)
      .map((e, i) => ({ ...e, rank: i + 1 }))
  }
  return boards
}
