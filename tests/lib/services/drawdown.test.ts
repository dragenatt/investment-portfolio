import { describe, it, expect } from 'vitest'
import { analyseDrawdowns, recoveryRequired } from '@/lib/services/drawdown'

const series = (values: number[], start = '2025-01-01') =>
  values.map((value, i) => {
    const d = new Date(`${start}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() + i)
    return { date: d.toISOString().slice(0, 10), value }
  })

describe('recoveryRequired', () => {
  it('says a 23% fall needs 29.9% to get back', () => {
    // The asymmetry the roadmap asks to be explained explicitly
    expect(recoveryRequired(23)).toBeCloseTo(29.87, 1)
  })

  it('says a 50% fall needs to double', () => {
    expect(recoveryRequired(50)).toBeCloseTo(100)
  })

  it('is zero for no fall', () => {
    expect(recoveryRequired(0)).toBe(0)
  })

  it('returns null for a total loss, which nothing recovers', () => {
    expect(recoveryRequired(100)).toBeNull()
    expect(recoveryRequired(120)).toBeNull()
  })

  it('returns null for a negative drawdown, which is not a drawdown', () => {
    expect(recoveryRequired(-5)).toBeNull()
  })
})

describe('analyseDrawdowns', () => {
  it('finds nothing in a series that only rises', () => {
    const result = analyseDrawdowns(series([100, 110, 120, 130]))
    expect(result.maxDrawdownPct).toBe(0)
    expect(result.episodes).toEqual([])
    expect(result.currentDrawdownPct).toBe(0)
  })

  it('measures a single fall and full recovery', () => {
    // 100 -> 80 is -20%, then back to 100
    const result = analyseDrawdowns(series([100, 90, 80, 90, 100]))
    expect(result.maxDrawdownPct).toBeCloseTo(20)
    expect(result.episodes).toHaveLength(1)
    const episode = result.episodes[0]
    expect(episode.depthPct).toBeCloseTo(20)
    expect(episode.recovered).toBe(true)
    expect(episode.troughDate).toBe('2025-01-03')
    expect(episode.peakDate).toBe('2025-01-01')
  })

  it('counts the days to fall and the days to climb back separately', () => {
    const result = analyseDrawdowns(series([100, 90, 80, 90, 100]))
    const episode = result.episodes[0]
    expect(episode.declineDays).toBe(2) // 01-01 -> 01-03
    expect(episode.recoveryDays).toBe(2) // 01-03 -> 01-05
  })

  it('leaves an unrecovered fall open and reports it as the current drawdown', () => {
    const result = analyseDrawdowns(series([100, 120, 90]))
    expect(result.episodes).toHaveLength(1)
    expect(result.episodes[0].recovered).toBe(false)
    expect(result.episodes[0].recoveryDays).toBeNull()
    expect(result.currentDrawdownPct).toBeCloseTo(25) // 90 against a 120 peak
  })

  it('separates two distinct episodes', () => {
    const result = analyseDrawdowns(series([100, 80, 100, 110, 88, 110]))
    expect(result.episodes).toHaveLength(2)
    expect(result.episodes[0].depthPct).toBeCloseTo(20)
    expect(result.episodes[1].depthPct).toBeCloseTo(20)
  })

  it('reports the worst episode as the max drawdown', () => {
    const result = analyseDrawdowns(series([100, 95, 100, 60, 100, 90, 100]))
    expect(result.maxDrawdownPct).toBeCloseTo(40)
    expect(result.worstEpisode?.depthPct).toBeCloseTo(40)
  })

  it('averages the episodes', () => {
    const result = analyseDrawdowns(series([100, 80, 100, 60, 100]))
    // -20% and -40%
    expect(result.averageDrawdownPct).toBeCloseTo(30)
  })

  it('reports the longest recovery it has seen, measured from the trough', () => {
    // Trough 01-02 back to the old peak on 01-06 is 4 days; the second episode
    // (trough 01-07, recovered 01-08) only took 1.
    const result = analyseDrawdowns(series([100, 90, 92, 94, 96, 100, 95, 100]))
    expect(result.longestRecoveryDays).toBe(4)
  })

  it('builds an underwater series where zero is the running peak', () => {
    const result = analyseDrawdowns(series([100, 90, 100, 110]))
    expect(result.underwater.map((u) => Math.round(u.pct))).toEqual([0, -10, 0, 0])
  })

  it('never emits a positive underwater value', () => {
    const result = analyseDrawdowns(series([100, 150, 120, 200, 180]))
    expect(result.underwater.every((u) => u.pct <= 0)).toBe(true)
  })

  it('says what the current hole needs to climb out of', () => {
    const result = analyseDrawdowns(series([100, 120, 90]))
    expect(result.recoveryRequiredPct).toBeCloseTo(33.33, 1)
  })

  it('handles an empty series without inventing anything', () => {
    const result = analyseDrawdowns([])
    expect(result.maxDrawdownPct).toBe(0)
    expect(result.underwater).toEqual([])
    expect(result.worstEpisode).toBeNull()
    expect(result.recoveryRequiredPct).toBe(0)
  })

  it('ignores non-positive values rather than dividing by them', () => {
    const result = analyseDrawdowns(series([100, 0, 80]))
    expect(Number.isFinite(result.maxDrawdownPct)).toBe(true)
    expect(result.underwater.every((u) => Number.isFinite(u.pct))).toBe(true)
  })

  it('is deterministic', () => {
    const input = series([100, 80, 100, 60, 100])
    expect(analyseDrawdowns(input)).toEqual(analyseDrawdowns(input))
  })
})
