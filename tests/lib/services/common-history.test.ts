import { describe, it, expect } from 'vitest'
import { alignCommonHistory } from '@/lib/services/common-history'

const days = (n: number, start = 1) =>
  Array.from({ length: n }, (_, i) => `2026-01-${String(start + i).padStart(2, '0')}`)

function rows(symbol: string, dates: string[], price = (i: number) => 100 + i) {
  return dates.map((date, i) => ({ symbol, date, close: price(i) }))
}

describe('alignCommonHistory', () => {
  const positions = [
    { symbol: 'AAA', quantity: 10 },
    { symbol: 'BBB', quantity: 5 },
  ]

  it('keeps only the dates every priced holding has', () => {
    const dates = days(30)
    const history = [...rows('AAA', dates), ...rows('BBB', dates.filter((_, i) => i !== 7))]
    const result = alignCommonHistory(positions, history, { minObservations: 5 })
    if ('message' in result) throw new Error(result.message)
    expect(result.commonDates).toHaveLength(29)
    expect(result.commonDates).not.toContain(dates[7])
    expect(result.returnsMatrix[0]).toHaveLength(28)
    expect(result.returnsMatrix[1]).toHaveLength(28)
  })

  it('values the book at the last common date for its current weights', () => {
    const dates = days(10)
    const history = [...rows('AAA', dates, () => 20), ...rows('BBB', dates, () => 40)]
    const result = alignCommonHistory(positions, history, { minObservations: 5 })
    if ('message' in result) throw new Error(result.message)
    // 10 x 20 = 200 and 5 x 40 = 200
    expect(result.currentWeights).toEqual([0.5, 0.5])
    expect(result.lastDate).toBe(dates[9])
  })

  it('drops a holding with no price history rather than failing the book', () => {
    const dates = days(10)
    const three = [...positions, { symbol: 'CCC', quantity: 1 }]
    const history = [...rows('AAA', dates), ...rows('BBB', dates)]
    const result = alignCommonHistory(three, history, { minObservations: 5 })
    if ('message' in result) throw new Error(result.message)
    expect(result.symbols).toEqual(['AAA', 'BBB'])
  })

  it('refuses a single holding, which has no allocation to compare', () => {
    const result = alignCommonHistory([positions[0]], rows('AAA', days(30)), { minObservations: 5 })
    expect(result).toHaveProperty('message')
  })

  it('refuses when fewer than two holdings have prices', () => {
    const result = alignCommonHistory(positions, rows('AAA', days(30)), { minObservations: 5 })
    expect(result).toHaveProperty('message')
  })

  it('says how much common history there is when it is not enough', () => {
    const dates = days(10)
    const result = alignCommonHistory(positions, [...rows('AAA', dates), ...rows('BBB', dates)], {
      minObservations: 60,
    })
    expect('message' in result && result.message).toMatch(/60.*9/)
  })
})
