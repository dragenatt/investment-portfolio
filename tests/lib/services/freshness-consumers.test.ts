import { describe, it, expect } from 'vitest'
import { summariseAllocation, type StoredQuote } from '@/lib/services/allocation-breakdown'
import { freshnessOfQuote } from '@/lib/services/freshness'

// 4.4. The same price, read by the two screens that mark freshness, gets the
// same verdict.
//
// The allocation tab reads a stored current_prices row; the portfolio page
// reads a batch quote. Each used to decide "stale" its own way — a row that
// exists, a quote that exists — so a price saved on Friday passed as current on
// both. Both now go through freshness.ts; this pins that they cannot drift
// apart again.

const NOW = new Date('2026-09-14T15:00:00Z')
const ago = (seconds: number) => new Date(NOW.getTime() - seconds * 1000).toISOString()

const cases: Array<{ name: string; fetchedAt: string | null }> = [
  { name: 'read a minute ago', fetchedAt: ago(60) },
  { name: 'read three hours ago', fetchedAt: ago(3 * 3600) },
  { name: 'saved on Friday', fetchedAt: ago(3 * 86400) },
  { name: 'never quoted', fetchedAt: null },
]

describe('allocation tab and portfolio page agree on freshness', () => {
  for (const { name, fetchedAt } of cases) {
    it(`for a price ${name}`, () => {
      const stored: Record<string, StoredQuote> = fetchedAt === null ? {} : { AAA: { price: 42, fetched_at: fetchedAt } }
      const [holding] = summariseAllocation(
        [{ symbol: 'AAA', asset_type: 'stock', quantity: 1, avg_cost: 40 }],
        stored,
        {},
        NOW,
      ).bySymbol

      const quote = fetchedAt === null ? undefined : { price: 42, fetchedAt }
      const onPortfolioPage = freshnessOfQuote(quote, { asOf: NOW })

      expect(holding.freshness.status).toBe(onPortfolioPage.status)
      expect(holding.freshness.label).toBe(onPortfolioPage.label)
      expect(holding.freshness.isCurrent).toBe(onPortfolioPage.isCurrent)
    })
  }

  it('covers all four states between them', () => {
    const statuses = cases.map(({ fetchedAt }) =>
      freshnessOfQuote(fetchedAt === null ? undefined : { price: 1, fetchedAt }, { asOf: NOW }).status,
    )
    expect(statuses).toEqual(['live', 'delayed', 'cached', 'unavailable'])
  })
})
