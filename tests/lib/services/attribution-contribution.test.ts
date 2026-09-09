import { describe, it, expect } from 'vitest'
import { contributionByAsset } from '@/lib/services/attribution'

const book = [
  { symbol: 'AAPL', sector: 'Technology', weight: 0.25, returnPct: 15.2 },
  { symbol: 'MSFT', sector: 'Technology', weight: 0.20, returnPct: 8.1 },
  { symbol: 'JPM', sector: 'Financials', weight: 0.30, returnPct: 4.0 },
  { symbol: 'BND', sector: 'Bonds', weight: 0.25, returnPct: -1.5 },
]

describe('contributionByAsset', () => {
  it('weights each return by how much of the book it was', () => {
    const result = contributionByAsset(book)
    const aapl = result.assets.find((a) => a.symbol === 'AAPL')!
    expect(aapl.contributionPct).toBeCloseTo(3.8) // 0.25 * 15.2
    const msft = result.assets.find((a) => a.symbol === 'MSFT')!
    expect(msft.contributionPct).toBeCloseTo(1.62) // 0.20 * 8.1
  })

  it('adds the contributions up to the portfolio return', () => {
    const result = contributionByAsset(book)
    const summed = result.assets.reduce((s, a) => s + a.contributionPct, 0)
    expect(summed).toBeCloseTo(result.totalReturnPct, 10)
    expect(result.totalReturnPct).toBeCloseTo(3.8 + 1.62 + 1.2 - 0.375)
  })

  it('ranks the biggest contributors first', () => {
    const contributions = contributionByAsset(book).assets.map((a) => a.contributionPct)
    expect([...contributions].sort((a, b) => b - a)).toEqual(contributions)
  })

  it('shows a detractor as a negative contribution, not a small positive one', () => {
    const bnd = contributionByAsset(book).assets.find((a) => a.symbol === 'BND')!
    expect(bnd.contributionPct).toBeCloseTo(-0.375)
  })

  it('rolls contributions up by sector', () => {
    const result = contributionByAsset(book)
    const tech = result.bySector.find((s) => s.sector === 'Technology')!
    expect(tech.contributionPct).toBeCloseTo(3.8 + 1.62)
    expect(tech.weight).toBeCloseTo(0.45)
  })

  it('files an asset with no sector under Unknown rather than dropping it', () => {
    const result = contributionByAsset([{ symbol: 'X', weight: 1, returnPct: 10 }])
    expect(result.bySector[0].sector).toBe('Unknown')
    expect(result.totalReturnPct).toBeCloseTo(10)
  })

  it('builds a waterfall that starts at zero and lands on the total', () => {
    const result = contributionByAsset(book)
    const last = result.waterfall[result.waterfall.length - 1]
    expect(last.cumulative).toBeCloseTo(result.totalReturnPct, 10)
    expect(result.waterfall[0].cumulative).toBeCloseTo(result.waterfall[0].value, 10)
  })

  it('separates realised from unrealised P&L when it is given them', () => {
    const result = contributionByAsset([
      { symbol: 'A', weight: 0.5, returnPct: 10, realizedPnl: 120, unrealizedPnl: 380 },
      { symbol: 'B', weight: 0.5, returnPct: 4, realizedPnl: -30, unrealizedPnl: 90 },
    ])
    expect(result.totalRealizedPnl).toBeCloseTo(90)
    expect(result.totalUnrealizedPnl).toBeCloseTo(470)
  })

  it('leaves the P&L totals null when no position reports any', () => {
    const result = contributionByAsset(book)
    expect(result.totalRealizedPnl).toBeNull()
    expect(result.totalUnrealizedPnl).toBeNull()
  })

  it('handles an empty book', () => {
    const result = contributionByAsset([])
    expect(result.assets).toEqual([])
    expect(result.totalReturnPct).toBe(0)
    expect(result.waterfall).toEqual([])
  })

  it('skips a position with an unusable return instead of poisoning the total', () => {
    const result = contributionByAsset([
      { symbol: 'A', weight: 0.5, returnPct: 10 },
      { symbol: 'BAD', weight: 0.5, returnPct: Number.NaN },
    ])
    expect(Number.isFinite(result.totalReturnPct)).toBe(true)
    expect(result.totalReturnPct).toBeCloseTo(5)
    expect(result.assets.map((a) => a.symbol)).toEqual(['A'])
  })

  it('is deterministic', () => {
    expect(contributionByAsset(book)).toEqual(contributionByAsset(book))
  })
})
