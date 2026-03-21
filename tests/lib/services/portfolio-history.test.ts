import { describe, it, expect } from 'vitest'
import { computeDailyPositions, buildDailyTimeline } from '@/lib/services/portfolio-history'

describe('computeDailyPositions', () => {
  it('returns empty array for no transactions', () => {
    expect(computeDailyPositions([])).toEqual([])
  })

  it('computes daily positions from buy transactions', () => {
    const transactions = [
      { executed_at: '2026-01-10T12:00:00Z', type: 'buy' as const, symbol: 'AAPL', quantity: 10, price: 150 },
      { executed_at: '2026-01-15T12:00:00Z', type: 'buy' as const, symbol: 'AAPL', quantity: 5, price: 160 },
    ]
    const result = computeDailyPositions(transactions)
    const jan10 = result.find(d => d.date === '2026-01-10')
    expect(jan10?.positions).toEqual({ AAPL: 10 })
    const jan15 = result.find(d => d.date === '2026-01-15')
    expect(jan15?.positions).toEqual({ AAPL: 15 })
  })

  it('handles sells correctly', () => {
    const transactions = [
      { executed_at: '2026-01-10T12:00:00Z', type: 'buy' as const, symbol: 'AAPL', quantity: 10, price: 150 },
      { executed_at: '2026-01-20T12:00:00Z', type: 'sell' as const, symbol: 'AAPL', quantity: 3, price: 170 },
    ]
    const result = computeDailyPositions(transactions)
    const jan20 = result.find(d => d.date === '2026-01-20')
    expect(jan20?.positions).toEqual({ AAPL: 7 })
  })
})

describe('buildDailyTimeline', () => {
  it('returns empty array for no snapshots', () => {
    expect(buildDailyTimeline([], {}, '2026-01-15')).toEqual([])
  })

  it('calculates portfolio value from positions and prices', () => {
    const snapshots = [
      { date: '2026-01-10', positions: { AAPL: 10 } },
    ]
    const historicalPrices = {
      AAPL: { '2026-01-10': 150, '2026-01-11': 152, '2026-01-12': 148 },
    }
    const result = buildDailyTimeline(snapshots, historicalPrices, '2026-01-12')
    expect(result).toHaveLength(3)
    expect(result[0]).toEqual({ date: '2026-01-10', value: 1500 })
    expect(result[1]).toEqual({ date: '2026-01-11', value: 1520 })
    expect(result[2]).toEqual({ date: '2026-01-12', value: 1480 })
  })

  it('carries forward last known price on weekends/holidays', () => {
    const snapshots = [
      { date: '2026-01-09', positions: { AAPL: 5 } },
    ]
    const historicalPrices = {
      AAPL: { '2026-01-09': 200 },
    }
    const result = buildDailyTimeline(snapshots, historicalPrices, '2026-01-11')
    expect(result[1].value).toBe(1000)
    expect(result[2].value).toBe(1000)
  })
})
