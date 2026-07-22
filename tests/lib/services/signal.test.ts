import { describe, it, expect } from 'vitest'
import { computeTechnicalSignal } from '@/lib/services/signal'

// Helpers to synthesize price series.
const rising = (n: number, start = 100, step = 1) =>
  Array.from({ length: n }, (_, i) => start + i * step)
const falling = (n: number, start = 300, step = 1) =>
  Array.from({ length: n }, (_, i) => start - i * step)

describe('computeTechnicalSignal', () => {
  it('holds with a neutral score when there is not enough data', () => {
    const s = computeTechnicalSignal([100, 101, 102])
    expect(s.action).toBe('hold')
    expect(s.score).toBe(0)
    expect(s.confidence).toBe(0)
    expect(s.metrics.price).toBe(102)
  })

  it('leans bullish on a sustained uptrend (price above its MAs)', () => {
    const s = computeTechnicalSignal(rising(120))
    expect(s.score).toBeGreaterThan(0)
    expect(s.metrics.price).toBeGreaterThan(s.metrics.sma20 ?? 0)
    // trend + momentum rules should fire bullish
    expect(s.reasons.some((r) => r.sentiment === 'bullish')).toBe(true)
  })

  it('leans bearish on a sustained downtrend (price below its MAs)', () => {
    const s = computeTechnicalSignal(falling(120))
    expect(s.score).toBeLessThan(0)
    expect(s.reasons.some((r) => r.sentiment === 'bearish')).toBe(true)
  })

  it('keeps the score within [-100, 100] and confidence within [0, 100]', () => {
    for (const series of [rising(250), falling(250), rising(40, 100, 5)]) {
      const s = computeTechnicalSignal(series)
      expect(s.score).toBeGreaterThanOrEqual(-100)
      expect(s.score).toBeLessThanOrEqual(100)
      expect(s.confidence).toBeGreaterThanOrEqual(0)
      expect(s.confidence).toBeLessThanOrEqual(100)
      expect(['buy', 'hold', 'sell']).toContain(s.action)
    }
  })

  it('uses SMA200 only when enough history is present', () => {
    expect(computeTechnicalSignal(rising(120)).metrics.sma200).toBeNull()
    expect(computeTechnicalSignal(rising(220)).metrics.sma200).not.toBeNull()
  })

  it('ignores non-finite values without crashing', () => {
    const series = [...rising(60), NaN, Infinity] as number[]
    const s = computeTechnicalSignal(series)
    expect(Number.isFinite(s.score)).toBe(true)
  })
})
