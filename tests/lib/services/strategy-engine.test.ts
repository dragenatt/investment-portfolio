import { describe, it, expect } from 'vitest'
import { runStrategy, compareStrategies } from '@/lib/services/strategy-engine'
import { EXAMPLE_STRATEGIES, type Strategy } from '@/lib/services/strategy-rule'
import type { Bar } from '@/lib/services/backtest'

/** Bars on consecutive days, following the supplied closes. */
function bars(closes: number[], from = '2024-01-01'): Bar[] {
  const cursor = new Date(`${from}T00:00:00Z`)
  return closes.map((close) => {
    const date = cursor.toISOString().slice(0, 10)
    cursor.setUTCDate(cursor.getUTCDate() + 1)
    return { date, close }
  })
}

/** Up, down, up — enough shape for any of the examples to fire. */
function cycle(n = 400): number[] {
  return Array.from({ length: n }, (_, i) => {
    const wave = Math.sin((i / n) * Math.PI * 3)
    return 100 * (1 + 0.4 * wave) * Math.pow(1.0004, i)
  })
}

const smaCross = EXAMPLE_STRATEGIES.find((e) => e.id === 'smaCross')!.strategy
const rsiReversion = EXAMPLE_STRATEGIES.find((e) => e.id === 'rsiReversion')!.strategy

describe('runStrategy', () => {
  const series = bars(cycle())

  it('returns a backtest with the strategy and buy-and-hold side by side', () => {
    const result = runStrategy(smaCross, series)!
    expect(result.backtest.strategy).toBeDefined()
    expect(result.backtest.buyAndHold).toBeDefined()
    expect(result.backtest.equityCurve.length).toBeGreaterThan(0)
  })

  it('sets the warmup from the strategy own longest indicator', () => {
    // A 50-period average cannot decide anything on bar 10. The caller should
    // not have to know that; the strategy already declares its longest period.
    const result = runStrategy(smaCross, series)!
    expect(result.warmupBars).toBeGreaterThanOrEqual(50)
  })

  it('gives a shorter warmup to a strategy that needs less history', () => {
    const rsi = runStrategy(rsiReversion, series)!
    const sma = runStrategy(smaCross, series)!
    expect(rsi.warmupBars).toBeLessThan(sma.warmupBars)
  })

  it('carries the validation warnings through to the caller', () => {
    // No sell rule means buy-and-hold wearing a strategy costume, and the
    // reader has to be told before reading the equity curve.
    const buyOnly: Strategy = { ...smaCross, sell: { combinator: 'and', conditions: [] } }
    const result = runStrategy(buyOnly, series)!
    expect(result.warnings.join(' ')).toMatch(/venta/i)
  })

  it('says whether the strategy beat simply holding', () => {
    const result = runStrategy(smaCross, series)!
    const beat = result.backtest.strategy.totalReturnPct > result.backtest.buyAndHold.totalReturnPct
    expect(result.beatBuyAndHold).toBe(beat)
  })

  it('reports the gap against buy-and-hold in percentage points', () => {
    const result = runStrategy(smaCross, series)!
    expect(result.versusBuyAndHoldPp).toBeCloseTo(
      result.backtest.strategy.totalReturnPct - result.backtest.buyAndHold.totalReturnPct,
      6,
    )
  })

  it('passes trading costs through, and costs make the result worse', () => {
    const free = runStrategy(smaCross, series, { costPct: 0 })!
    const costly = runStrategy(smaCross, series, { costPct: 0.5 })!
    if (free.backtest.trades.length > 0) {
      expect(costly.backtest.strategy.totalReturnPct).toBeLessThan(
        free.backtest.strategy.totalReturnPct,
      )
    }
  })

  it('refuses a strategy that does not validate', () => {
    expect(runStrategy({ ...smaCross, name: '' }, series)).toBeNull()
  })

  it('refuses a history too short for the warmup the strategy needs', () => {
    // 50-period average against 30 bars: there is nothing to test.
    expect(runStrategy(smaCross, bars(cycle(30)))).toBeNull()
  })

  it('never emits a non-finite headline number', () => {
    const result = runStrategy(smaCross, series)!
    expect(Number.isFinite(result.versusBuyAndHoldPp)).toBe(true)
    expect(Number.isFinite(result.backtest.strategy.totalReturnPct)).toBe(true)
  })

  it('is deterministic', () => {
    expect(runStrategy(smaCross, series)).toEqual(runStrategy(smaCross, series))
  })
})

describe('compareStrategies', () => {
  const series = bars(cycle())

  it('runs every strategy against the same bars', () => {
    const result = compareStrategies(
      [smaCross, rsiReversion],
      series,
    )!
    expect(result.results).toHaveLength(2)
    // Same asset, so buy-and-hold must be identical for both — otherwise the
    // comparison is between two different histories.
    const [a, b] = result.results
    expect(a.backtest.buyAndHold.totalReturnPct).toBeCloseTo(
      b.backtest.buyAndHold.totalReturnPct,
      6,
    )
  })

  it('measures every strategy over ONE window, not each over its own', () => {
    // Regression. Each strategy sets its warmup from its longest indicator, so
    // the 50-day cross started 60 bars in and the RSI rule at 24 — and
    // buy-and-hold came out -17.3% for one and -4.1% for the other on the same
    // asset. A table of two different windows is not a comparison of methods.
    const result = compareStrategies([smaCross, rsiReversion], series)!
    for (const run of result.results) {
      expect(run.warmupBars).toBe(result.sharedWarmupBars)
    }
    // And the shared window is long enough for the hungriest of them
    expect(result.sharedWarmupBars).toBeGreaterThanOrEqual(50)
  })

  it('excludes the impossible before taking the shared window', () => {
    // Regression. The momentum example needs a 200-day average. Taking the
    // maximum across ALL strategies dragged the shared warmup past the end of
    // six months of daily bars, and nothing at all could run — one demanding
    // rule blanked the table for every other.
    const momentum = EXAMPLE_STRATEGIES.find((e) => e.id === 'momentum')!.strategy
    const short = bars(cycle(150))

    const result = compareStrategies([smaCross, rsiReversion, momentum], short)!
    expect(result.results.length).toBeGreaterThanOrEqual(2)
    expect(result.skipped.map((s) => s.name)).toContain(momentum.name)
    // And the skip says what was missing, not just that it failed
    expect(result.skipped[0].reason).toMatch(/\d+/)
  })

  it('does not run the same strategy twice', () => {
    // The builder sends the user's strategy AND the examples, so starting from
    // an example sent it twice: two identical rows and a duplicate React key.
    const result = compareStrategies([smaCross, rsiReversion, smaCross], series)!
    const names = result.results.map((r) => r.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('reports the buy-and-hold benchmark once, not per strategy', () => {
    const result = compareStrategies([smaCross, rsiReversion], series)!
    expect(Number.isFinite(result.buyAndHoldReturnPct)).toBe(true)
  })

  it('counts how many strategies actually beat holding', () => {
    const result = compareStrategies([smaCross, rsiReversion], series)!
    const beaters = result.results.filter((r) => r.beatBuyAndHold).length
    expect(result.beatCount).toBe(beaters)
  })

  it('says plainly when none of them beat holding', () => {
    const result = compareStrategies([smaCross, rsiReversion], series)!
    expect(result.summary.length).toBeGreaterThan(60)
    if (result.beatCount === 0) {
      expect(result.summary.toLowerCase()).toMatch(/ninguna|comprar y mantener/)
    }
  })

  it('skips a strategy that cannot run rather than failing the whole comparison', () => {
    const broken: Strategy = { ...smaCross, name: '' }
    const result = compareStrategies([smaCross, broken], series)!
    expect(result.results).toHaveLength(1)
    expect(result.skipped).toHaveLength(1)
  })

  it('returns null when nothing can run', () => {
    expect(compareStrategies([{ ...smaCross, name: '' }], series)).toBeNull()
  })

  it('handles an empty list', () => {
    expect(compareStrategies([], series)).toBeNull()
  })
})

// ─── Walk-forward (P1-18) ───────────────────────────────────────────────────

import { walkForwardStrategy } from '@/lib/services/strategy-engine'

describe('walkForwardStrategy', () => {
  function trending(length: number) {
    let price = 100
    return Array.from({ length }, (_, i) => {
      price *= 1 + Math.sin(i / 9) * 0.012 + 0.0008
      return { date: new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10), close: price }
    })
  }
  const cross = {
    name: 'cruce',
    buy: { combinator: 'and' as const, conditions: [{ left: { kind: 'indicator' as const, indicator: 'sma' as const, period: 10 }, operator: 'crossesAbove' as const, right: { kind: 'indicator' as const, indicator: 'sma' as const, period: 30 } }] },
    sell: { combinator: 'and' as const, conditions: [{ left: { kind: 'indicator' as const, indicator: 'sma' as const, period: 10 }, operator: 'crossesBelow' as const, right: { kind: 'indicator' as const, indicator: 'sma' as const, period: 30 } }] },
  }

  it('never tests a bar it already tested, and trains on history sized to the rule', () => {
    const wf = walkForwardStrategy(cross, trending(200))!
    expect(wf.windows.length).toBeGreaterThanOrEqual(2)
    // Longest indicator 30 plus the warmup margin.
    expect(wf.config.trainBars).toBe(40)
    for (let i = 1; i < wf.windows.length; i++) {
      expect(wf.windows[i].testFrom > wf.windows[i - 1].testTo).toBe(true)
    }
    expect(wf.explanation).toContain('nunca se usaron antes')
  })

  it('reports nothing when the history cannot hold two windows', () => {
    expect(walkForwardStrategy(cross, trending(70))).toBeNull()
  })

  it('reports nothing for a strategy that does not validate', () => {
    expect(walkForwardStrategy({ ...cross, buy: { combinator: 'and', conditions: [] } }, trending(200))).toBeNull()
  })
})
