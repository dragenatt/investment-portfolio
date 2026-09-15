import { describe, it, expect } from 'vitest'
import { summariseIncome } from '@/lib/services/dividend-analytics'
import type { IncomeData } from '@/lib/hooks/use-analytics'

const now = new Date('2026-09-15T12:00:00Z')

describe('summariseIncome', () => {
  const dividends = [
    { symbol: 'AAA', amount: 10, date: '2025-06-01T12:00:00Z' }, // older than a year
    { symbol: 'AAA', amount: 20, date: '2025-12-15T12:00:00Z' },
    { symbol: 'BBB', amount: 30, date: '2026-03-01T12:00:00Z' },
    { symbol: 'AAA', amount: 40, date: '2026-09-02T12:00:00Z' },
  ]

  it('returns the totals, positions and history the income tab reads', () => {
    const income = summariseIncome(dividends, 1800, now)
    expect(income.totals).toEqual({ mtd: 40, ytd: 70, all_time: 100, portfolio_yield: (90 / 1800) * 100 })
    expect(income.by_position).toEqual([
      { symbol: 'AAA', total: 70, count: 3 },
      { symbol: 'BBB', total: 30, count: 1 },
    ])
    expect(income.monthly_history.map((m) => m.month)).toEqual(['2025-06', '2025-12', '2026-03', '2026-09'])
  })

  it('matches the IncomeData contract, which it used not to', () => {
    const income: IncomeData = summariseIncome(dividends, 1000, now)
    expect(Object.keys(income).sort()).toEqual(['by_position', 'monthly_history', 'totals'])
  })

  it('reports no yield without a portfolio value, and nothing for no dividends', () => {
    expect(summariseIncome(dividends, 0, now).totals.portfolio_yield).toBe(0)
    expect(summariseIncome([], 5000, now)).toEqual({ totals: { mtd: 0, ytd: 0, all_time: 0, portfolio_yield: 0 }, by_position: [], monthly_history: [] })
  })
})
