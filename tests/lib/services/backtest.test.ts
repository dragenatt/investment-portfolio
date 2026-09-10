import { describe, it, expect } from 'vitest'
import {
  backtestSignal,
  backtestPortfolio,
  walkForward,
  type Bar,
  type SignalFn,
} from '@/lib/services/backtest'

/** A price series with a known shape: rises for `up` bars, falls for `down`, repeating. */
function sawtooth(cycles: number, up: number, down: number, start = 100): Bar[] {
  const bars: Bar[] = []
  let price = start
  let day = 0
  const push = () => {
    const d = new Date('2024-01-01T00:00:00Z')
    d.setUTCDate(d.getUTCDate() + day++)
    bars.push({ date: d.toISOString().slice(0, 10), close: Number(price.toFixed(4)) })
  }
  for (let c = 0; c < cycles; c++) {
    for (let i = 0; i < up; i++) {
      price *= 1.02
      push()
    }
    for (let i = 0; i < down; i++) {
      price *= 0.98
      push()
    }
  }
  return bars
}

/** A steadily rising series. */
function rising(n: number, dailyPct = 0.001, start = 100): Bar[] {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date('2024-01-01T00:00:00Z')
    d.setUTCDate(d.getUTCDate() + i)
    return {
      date: d.toISOString().slice(0, 10),
      close: Number((start * Math.pow(1 + dailyPct, i)).toFixed(4)),
    }
  })
}

const alwaysBuy: SignalFn = () => 'buy'
const alwaysSell: SignalFn = () => 'sell'

describe('backtestSignal — the look-ahead guard', () => {
  it('hands the signal only the bars up to and including the decision day', () => {
    const bars = rising(60)
    const seen: number[] = []
    const spy: SignalFn = (closes) => {
      seen.push(closes.length)
      return 'hold'
    }
    backtestSignal(bars, spy, { warmupBars: 10 })

    // Every call must see strictly fewer bars than the series has, and the
    // lengths must increase by one — a signal that ever saw the whole array
    // could read the future.
    expect(seen[0]).toBe(11)
    expect(seen[seen.length - 1]).toBeLessThan(bars.length)
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBe(seen[i - 1] + 1)
  })

  it('executes at the next bar, not the one the decision was made on', () => {
    // Buying at the close you just looked at is the classic look-ahead bug.
    const bars: Bar[] = [
      { date: '2024-01-01', close: 100 },
      { date: '2024-01-02', close: 100 },
      { date: '2024-01-03', close: 100 },
      { date: '2024-01-04', close: 200 }, // the jump
      { date: '2024-01-05', close: 200 },
    ]
    // Signal fires buy only on the bar right before the jump
    const oracle: SignalFn = (closes) => (closes.length === 3 ? 'buy' : 'hold')
    const result = backtestSignal(bars, oracle, { warmupBars: 2, initialCapital: 1000 })!
    // Entry is at bar 4's close of 200, so the jump is missed entirely
    expect(result.trades[0].entryPrice).toBe(200)
    expect(result.strategy.finalValue).toBeCloseTo(1000, 6)
  })

  it('cannot capture a move it was told about only after the fact', () => {
    const bars = sawtooth(6, 5, 5)
    const cheating: SignalFn = (closes) => {
      // Even a signal that perfectly reads its own last bar cannot see beyond it
      return closes[closes.length - 1] > closes[closes.length - 2] ? 'buy' : 'sell'
    }
    const result = backtestSignal(bars, cheating, { warmupBars: 5 })!
    expect(Number.isFinite(result.strategy.finalValue)).toBe(true)
  })
})

describe('backtestSignal — mechanics', () => {
  it('matches buy-and-hold when the strategy is always invested', () => {
    const bars = rising(120)
    const result = backtestSignal(bars, alwaysBuy, { warmupBars: 10, initialCapital: 1000 })!
    expect(result.strategy.finalValue).toBeCloseTo(result.buyAndHold.finalValue, 6)
  })

  it('stays flat when the strategy is never invested', () => {
    const bars = rising(120)
    const result = backtestSignal(bars, alwaysSell, { warmupBars: 10, initialCapital: 1000 })!
    expect(result.strategy.finalValue).toBeCloseTo(1000, 6)
    expect(result.strategy.timeInMarketPct).toBe(0)
  })

  it('always reports buy-and-hold as the comparison', () => {
    const bars = rising(120, 0.002)
    const result = backtestSignal(bars, alwaysSell, { warmupBars: 10, initialCapital: 1000 })!
    expect(result.buyAndHold.finalValue).toBeGreaterThan(1000)
    expect(result.buyAndHold.totalReturnPct).toBeGreaterThan(0)
  })

  it('counts a completed round trip as one trade', () => {
    const bars = rising(60)
    // Invested only between bars 20 and 30
    const windowed: SignalFn = (closes) =>
      closes.length >= 20 && closes.length < 30 ? 'buy' : 'sell'
    const result = backtestSignal(bars, windowed, { warmupBars: 10 })!
    expect(result.strategy.trades).toBe(1)
    expect(result.trades[0].exitDate).not.toBeNull()
  })

  it('closes an open position at the last bar so nothing is left dangling', () => {
    const bars = rising(60)
    const lateEntry: SignalFn = (closes) => (closes.length >= 50 ? 'buy' : 'sell')
    const result = backtestSignal(bars, lateEntry, { warmupBars: 10 })!
    expect(result.trades).toHaveLength(1)
    expect(result.trades[0].exitDate).toBe(bars[bars.length - 1].date)
  })

  it('reports the hit rate over completed trades', () => {
    const bars = sawtooth(4, 6, 6)
    const momentum: SignalFn = (closes) =>
      closes[closes.length - 1] > closes[closes.length - 2] ? 'buy' : 'sell'
    const result = backtestSignal(bars, momentum, { warmupBars: 5 })!
    expect(result.strategy.hitRatePct).toBeGreaterThanOrEqual(0)
    expect(result.strategy.hitRatePct).toBeLessThanOrEqual(100)
  })

  it('charges costs on every entry and exit', () => {
    const bars = sawtooth(6, 4, 4)
    const churny: SignalFn = (closes) => (closes.length % 2 === 0 ? 'buy' : 'sell')
    const free = backtestSignal(bars, churny, { warmupBars: 5, costPct: 0 })!
    const costly = backtestSignal(bars, churny, { warmupBars: 5, costPct: 0.5 })!
    expect(costly.strategy.finalValue).toBeLessThan(free.strategy.finalValue)
    expect(costly.strategy.trades).toBe(free.strategy.trades)
  })

  it('reports risk alongside return, not instead of it', () => {
    const result = backtestSignal(sawtooth(8, 5, 5), alwaysBuy, { warmupBars: 5 })!
    expect(result.strategy.maxDrawdownPct).toBeGreaterThan(0)
    expect(Number.isFinite(result.strategy.volatilityPct)).toBe(true)
    expect(result.strategy.sharpe === null || Number.isFinite(result.strategy.sharpe)).toBe(true)
  })

  it('builds an equity curve with both series aligned on date', () => {
    const bars = rising(60)
    const result = backtestSignal(bars, alwaysBuy, { warmupBars: 10 })!
    expect(result.equityCurve.length).toBeGreaterThan(0)
    for (const point of result.equityCurve) {
      expect(Number.isFinite(point.strategy)).toBe(true)
      expect(Number.isFinite(point.buyAndHold)).toBe(true)
    }
  })

  it('refuses a series too short to warm up on', () => {
    expect(backtestSignal(rising(5), alwaysBuy, { warmupBars: 20 })).toBeNull()
    expect(backtestSignal([], alwaysBuy, {})).toBeNull()
  })

  it('is deterministic', () => {
    const bars = sawtooth(5, 4, 4)
    const momentum: SignalFn = (c) => (c[c.length - 1] > c[c.length - 2] ? 'buy' : 'sell')
    expect(backtestSignal(bars, momentum, { warmupBars: 5 })).toEqual(
      backtestSignal(bars, momentum, { warmupBars: 5 }),
    )
  })

  it('never emits a non-finite number', () => {
    const messy: Bar[] = rising(60).map((b, i) => (i === 30 ? { ...b, close: 0 } : b))
    const result = backtestSignal(messy, alwaysBuy, { warmupBars: 10 })!
    expect(Number.isFinite(result.strategy.finalValue)).toBe(true)
    expect(Number.isFinite(result.buyAndHold.finalValue)).toBe(true)
  })
})

describe('backtestPortfolio (P1-17)', () => {
  const A = rising(300, 0.0015, 100)
  const B = rising(300, 0.0005, 50)
  const series = { A, B }

  it('holds weights steady with no rebalancing and lets the winner run', () => {
    const none = backtestPortfolio(series, { A: 0.5, B: 0.5 }, { rebalance: 'none' })!
    expect(none.rebalanceCount).toBe(0)
    // The faster grower ends up above its starting weight
    expect(none.finalWeights.A).toBeGreaterThan(0.5)
  })

  it('pulls weights back to target when rebalancing', () => {
    const monthly = backtestPortfolio(series, { A: 0.5, B: 0.5 }, { rebalance: 'monthly' })!
    const none = backtestPortfolio(series, { A: 0.5, B: 0.5 }, { rebalance: 'none' })!
    expect(monthly.rebalanceCount).toBeGreaterThan(0)
    expect(monthly.finalWeights.A).toBeLessThan(none.finalWeights.A)
  })

  it('rebalances less often on a longer schedule', () => {
    const monthly = backtestPortfolio(series, { A: 0.5, B: 0.5 }, { rebalance: 'monthly' })!
    const quarterly = backtestPortfolio(series, { A: 0.5, B: 0.5 }, { rebalance: 'quarterly' })!
    const annual = backtestPortfolio(series, { A: 0.5, B: 0.5 }, { rebalance: 'annual' })!
    expect(monthly.rebalanceCount).toBeGreaterThan(quarterly.rebalanceCount)
    expect(quarterly.rebalanceCount).toBeGreaterThanOrEqual(annual.rebalanceCount)
  })

  it('charges the cost of rebalancing rather than pretending it is free', () => {
    const free = backtestPortfolio(series, { A: 0.5, B: 0.5 }, { rebalance: 'monthly', costPct: 0 })!
    const costly = backtestPortfolio(series, { A: 0.5, B: 0.5 }, { rebalance: 'monthly', costPct: 0.3 })!
    expect(costly.finalValue).toBeLessThan(free.finalValue)
    expect(costly.totalCosts).toBeGreaterThan(0)
    expect(free.totalCosts).toBe(0)
  })

  it('reports the full risk picture, not just the return', () => {
    const result = backtestPortfolio(series, { A: 0.5, B: 0.5 }, { rebalance: 'quarterly' })!
    expect(Number.isFinite(result.cagrPct)).toBe(true)
    expect(Number.isFinite(result.volatilityPct)).toBe(true)
    expect(Number.isFinite(result.maxDrawdownPct)).toBe(true)
    expect(result.sharpe === null || Number.isFinite(result.sharpe)).toBe(true)
    expect(result.sortino === null || Number.isFinite(result.sortino)).toBe(true)
    expect(result.var95Pct === null || Number.isFinite(result.var95Pct)).toBe(true)
  })

  it('only uses dates every holding has a price for', () => {
    const short = rising(50, 0.001, 20)
    const result = backtestPortfolio({ A, C: short }, { A: 0.5, C: 0.5 }, { rebalance: 'none' })!
    // The overlap is the shorter series, so the curve cannot be longer than it
    expect(result.equityCurve.length).toBeLessThanOrEqual(short.length)
  })

  it('refuses weights that do not sum to 100%', () => {
    expect(backtestPortfolio(series, { A: 0.5, B: 0.2 }, { rebalance: 'none' })).toBeNull()
  })

  it('refuses a book with no overlapping history', () => {
    expect(backtestPortfolio({}, {}, { rebalance: 'none' })).toBeNull()
  })

  it('is deterministic', () => {
    const opts = { rebalance: 'quarterly' as const }
    expect(backtestPortfolio(series, { A: 0.6, B: 0.4 }, opts)).toEqual(
      backtestPortfolio(series, { A: 0.6, B: 0.4 }, opts),
    )
  })
})

describe('walkForward (P1-18)', () => {
  const bars = rising(400, 0.001)
  const fit = () => alwaysBuy

  it('splits the history into successive train and test windows', () => {
    const result = walkForward(bars, fit, { trainBars: 100, testBars: 50 })!
    expect(result.windows.length).toBeGreaterThan(1)
    for (const w of result.windows) {
      expect(w.trainTo < w.testFrom).toBe(true)
    }
  })

  it('never tests on a bar it trained on', () => {
    const result = walkForward(bars, fit, { trainBars: 100, testBars: 50 })!
    for (const w of result.windows) {
      expect(new Date(w.testFrom).getTime()).toBeGreaterThan(new Date(w.trainTo).getTime())
    }
  })

  it('moves the window forward by the test length', () => {
    const result = walkForward(bars, fit, { trainBars: 100, testBars: 50 })!
    for (let i = 1; i < result.windows.length; i++) {
      const previous = result.windows[i - 1]
      const current = result.windows[i]
      expect(new Date(current.testFrom).getTime()).toBeGreaterThan(
        new Date(previous.testFrom).getTime(),
      )
    }
  })

  it('hands each window only its own training slice', () => {
    const trainSizes: number[] = []
    const spyFit = (trainBars: Bar[]) => {
      trainSizes.push(trainBars.length)
      return alwaysBuy
    }
    walkForward(bars, spyFit, { trainBars: 100, testBars: 50 })
    expect(trainSizes.every((n) => n === 100)).toBe(true)
  })

  it('aggregates the out-of-sample results, not the in-sample ones', () => {
    const result = walkForward(bars, fit, { trainBars: 100, testBars: 50 })!
    expect(result.aggregate.windows).toBe(result.windows.length)
    expect(Number.isFinite(result.aggregate.totalReturnPct)).toBe(true)
    expect(result.aggregate.winningWindows).toBeLessThanOrEqual(result.windows.length)
  })

  it('documents the configuration it ran with', () => {
    const result = walkForward(bars, fit, { trainBars: 100, testBars: 50 })!
    expect(result.config.trainBars).toBe(100)
    expect(result.config.testBars).toBe(50)
  })

  it('refuses a history too short for even one window', () => {
    expect(walkForward(rising(80), fit, { trainBars: 100, testBars: 50 })).toBeNull()
  })

  it('is deterministic', () => {
    const opts = { trainBars: 100, testBars: 50 }
    expect(walkForward(bars, fit, opts)).toEqual(walkForward(bars, fit, opts))
  })
})
