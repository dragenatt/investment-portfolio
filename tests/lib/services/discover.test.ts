import { describe, it, expect } from 'vitest'
import {
  buildLeaderboards,
  isLeaderboardCategory,
  isSearchableQuery,
  publicDisplayName,
  toUserSearchResults,
  publicPortfolioArgs,
  toPublicPortfolio,
  type LeaderboardSnapshot,
  dailyMovers,
} from '@/lib/services/discover'

describe('publicPortfolioArgs', () => {
  it('names every argument the way get_public_portfolios declares it', () => {
    // The route used to send sort/order/filter/page/limit, and PostgREST answered
    // "Could not find the function public.get_public_portfolios(filter, limit, ...)".
    const args = publicPortfolioArgs(new URLSearchParams('sort=return&order=desc&filter=all&page=2'))
    expect(Object.keys(args).sort()).toEqual(['asset_filter', 'min_positions', 'page_num', 'page_size', 'sort_by', 'sort_order'])
    expect(args).toEqual({ sort_by: 'return_pct', sort_order: 'desc', asset_filter: null, min_positions: 0, page_num: 2, page_size: 20 })
  })

  it('maps the page sorts to the ones the function orders by', () => {
    const sortBy = (sort: string) => publicPortfolioArgs(new URLSearchParams({ sort })).sort_by
    expect(sortBy('recent')).toBe('newest')
    expect(sortBy('return')).toBe('return_pct')
    expect(sortBy('likes')).toBe('likes')
    expect(sortBy('value')).toBe('newest') // no longer offered; amounts may be private
  })

  it('never sends a null minimum, which would filter out every portfolio', () => {
    expect(publicPortfolioArgs(new URLSearchParams()).min_positions).toBe(0)
    expect(publicPortfolioArgs(new URLSearchParams('min_positions=abc')).min_positions).toBe(0)
    expect(publicPortfolioArgs(new URLSearchParams('min_positions=3')).min_positions).toBe(3)
  })

  it('keeps paging inside sane bounds', () => {
    const args = publicPortfolioArgs(new URLSearchParams('page=-4&limit=5000&order=sideways'))
    expect(args.page_num).toBe(1)
    expect(args.page_size).toBe(50)
    expect(args.sort_order).toBe('desc')
  })
})

describe('toPublicPortfolio', () => {
  it('turns a function row into what the pages read, numbers included', () => {
    const portfolio = toPublicPortfolio({
      portfolio_id: 'p1',
      portfolio_name: 'Largo plazo',
      owner_user_id: 'u1',
      username: 'ana',
      display_name: 'Ana',
      avatar_url: null,
      total_return_pct: '12.5',
      sharpe_ratio: null,
      volatility: null,
      position_count: 6,
      like_count: null,
      view_count: 3,
      tags: null,
      snapshot_date: '2026-09-15',
    })
    expect(portfolio).toEqual({
      id: 'p1',
      name: 'Largo plazo',
      userId: 'u1',
      returnPercent: 12.5,
      sharpeRatio: null,
      positionCount: 6,
      likeCount: 0,
      tags: [],
      snapshotDate: '2026-09-15',
      owner: { id: 'u1', username: 'ana', displayName: 'Ana', avatarUrl: null },
    })
  })
})

describe('buildLeaderboards', () => {
  const snapshot = (id: string, over: Partial<LeaderboardSnapshot> = {}): LeaderboardSnapshot => ({
    portfolio_id: id,
    portfolio_name: `Portafolio ${id}`,
    user_id: `u-${id}`,
    like_count: 0,
    total_value: 1000,
    total_return_pct: 0,
    sharpe_ratio: null,
    volatility: null,
    win_rate: null,
    ...over,
  })

  const profiles = [{ user_id: 'u-a', username: 'ana', display_name: 'Ana', avatar_url: null }]

  it('ranks each category in its own direction and numbers from 1', () => {
    const boards = buildLeaderboards(
      [
        snapshot('a', { total_return_pct: 8, sharpe_ratio: 1.2, volatility: 0.01, win_rate: 0.55 }),
        snapshot('b', { total_return_pct: '15', sharpe_ratio: 0.4, volatility: 0.02, win_rate: 0.6 }),
      ],
      profiles,
    )
    expect(boards.returns.map((r) => [r.rank, r.portfolioId])).toEqual([[1, 'b'], [2, 'a']])
    expect(boards.sharpe.map((r) => r.portfolioId)).toEqual(['a', 'b'])
    expect(boards.volatility.map((r) => r.portfolioId)).toEqual(['a', 'b']) // lowest first
    expect(boards.consistency.map((r) => r.portfolioId)).toEqual(['b', 'a'])
  })

  it('joins the profile, annualises volatility and reports win rate as a percentage', () => {
    const [a] = buildLeaderboards([snapshot('a', { volatility: 0.01, win_rate: 0.55 })], profiles).volatility
    expect(a).toMatchObject({ username: 'ana', displayName: 'Ana' })
    expect(a.winRatePct).toBeCloseTo(55, 10)
    expect(a.volatilityPct).toBeCloseTo(0.01 * Math.sqrt(252) * 100, 10)
  })

  it('leaves a portfolio out of a category it has no metric for, instead of ranking it as zero', () => {
    // Without five nights of history a new portfolio has no volatility; as zero it would top "lowest volatility".
    const boards = buildLeaderboards([snapshot('new'), snapshot('old', { volatility: 0.015 })], [])
    expect(boards.volatility.map((r) => r.portfolioId)).toEqual(['old'])
    expect(boards.returns.map((r) => r.portfolioId).sort()).toEqual(['new', 'old'])
  })

  it('drops empty portfolios and carries no money amounts', () => {
    const boards = buildLeaderboards([snapshot('empty', { total_value: 0 }), snapshot('a', { total_value: 250000 })], profiles)
    expect(boards.returns.map((r) => r.portfolioId)).toEqual(['a'])
    expect(JSON.stringify(boards)).not.toContain('250000')
  })

  it('knows its categories', () => {
    expect(isLeaderboardCategory('returns')).toBe(true)
    expect(isLeaderboardCategory('return')).toBe(false)
  })
})

describe('publicDisplayName', () => {
  it('never shows an email address as a name', () => {
    expect(publicDisplayName('gohan@example.com')).toBeNull()
    expect(publicDisplayName('  ')).toBeNull()
    expect(publicDisplayName(null)).toBeNull()
    expect(publicDisplayName(' Ana López ')).toBe('Ana López')
  })

  it('applies to portfolio owners and leaderboard rows', () => {
    const row = {
      portfolio_id: 'p', portfolio_name: 'P', owner_user_id: 'u', username: 'ana', display_name: 'ana@example.com',
      avatar_url: null, total_return_pct: null, sharpe_ratio: null, volatility: null, position_count: null,
      like_count: 0, view_count: 0, tags: [], snapshot_date: null,
    }
    expect(toPublicPortfolio(row).owner.displayName).toBeNull()
    const [ranked] = buildLeaderboards(
      [{ portfolio_id: 'p', portfolio_name: 'P', user_id: 'u', like_count: 0, total_value: 1, total_return_pct: 1, sharpe_ratio: null, volatility: null, win_rate: null }],
      [{ user_id: 'u', username: 'ana', display_name: 'ana@example.com', avatar_url: null }],
    ).returns
    expect(ranked.displayName).toBeNull()
    expect(ranked.username).toBe('ana')
  })
})

describe('user search', () => {
  it('refuses queries that could look up an email address', () => {
    expect(isSearchableQuery('gohan@gmail.com')).toBe(false)
    expect(isSearchableQuery('@')).toBe(false)
    expect(isSearchableQuery(' a ')).toBe(false)
    expect(isSearchableQuery(null)).toBe(false)
    expect(isSearchableQuery('ana')).toBe(true)
  })

  it('returns people with a username, without the email kept in display_name', () => {
    expect(toUserSearchResults([
      { user_id: 'u1', username: 'ana', display_name: 'ana@example.com', avatar_url: null, follower_count: null },
      { user_id: 'u2', username: null, display_name: 'Sin usuario', avatar_url: null, follower_count: 3 },
      { user_id: 'u3', username: 'luis', display_name: 'Luis', avatar_url: 'https://a/b.png', follower_count: 4 },
    ])).toEqual([
      { id: 'u1', username: 'ana', displayName: null, avatarUrl: null, followerCount: 0 },
      { id: 'u3', username: 'luis', displayName: 'Luis', avatarUrl: 'https://a/b.png', followerCount: 4 },
    ])
  })
})

describe('dailyMovers', () => {
  // Discover listed one public portfolio as the #1 winner AND the #1 loser of
  // the same day — winners and losers were the two ends of one sorted list —
  // and counted a deposit as a gain. Synthetic portfolios.
  const names = { a: 'Alfa', b: 'Beta', c: 'Gamma' }
  const snap = (portfolio_id: string, total_value: number, total_cost: number) => ({ portfolio_id, total_value, total_cost })

  it('never lists a portfolio as both a winner and a loser', () => {
    const { winners, losers } = dailyMovers([snap('a', 101, 100)], [snap('a', 100, 100)], names)

    expect(winners.map((m) => m.portfolio_id)).toEqual(['a'])
    expect(losers).toEqual([])
  })

  it('puts a rise in winners and a fall in losers, largest first', () => {
    const { winners, losers } = dailyMovers(
      [snap('a', 103, 100), snap('b', 98, 100), snap('c', 101, 100)],
      [snap('a', 100, 100), snap('b', 100, 100), snap('c', 100, 100)],
      names,
    )

    expect(winners.map((m) => m.name)).toEqual(['Alfa', 'Gamma'])
    expect(losers.map((m) => m.name)).toEqual(['Beta'])
    expect(losers[0].change_pct).toBeCloseTo(-2)
  })

  it('does not count a deposit as a gain', () => {
    // 10,000 in the morning, 10,000 more bought in the afternoon, nothing
    // moved: value doubled, the return is zero.
    const { winners, losers } = dailyMovers([snap('a', 20_000, 20_000)], [snap('a', 10_000, 10_000)], names)

    expect(winners).toEqual([])
    expect(losers).toEqual([])
  })

  it('still sees the market move on top of a deposit', () => {
    // Doubled the stake and the whole book rose 100 on the day.
    const { winners } = dailyMovers([snap('a', 20_100, 20_000)], [snap('a', 10_000, 10_000)], names)

    expect(winners[0].change).toBeCloseTo(100)
    expect(winners[0].change_pct).toBeCloseTo(1)
  })

  it('leaves out portfolios that are not public or have no snapshot yesterday', () => {
    const { winners } = dailyMovers(
      [snap('a', 110, 100), snap('private', 150, 100), snap('b', 120, 100)],
      [snap('a', 100, 100), snap('private', 100, 100)],
      names,
    )

    expect(winners.map((m) => m.portfolio_id)).toEqual(['a'])
  })
})
