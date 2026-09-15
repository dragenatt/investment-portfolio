import { describe, it, expect } from 'vitest'
import {
  computeDailyPositions,
  buildDailyTimeline,
  reconstructBookHistory,
  snapshotsCoverWindow,
  type BookTransaction,
} from '@/lib/services/portfolio-history'
import { calculateTWR, calculateMWR } from '@/lib/services/returns'

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

// ─── Book history for TWR ───────────────────────────────────────────────────

const t = (
  date: string,
  type: BookTransaction['type'],
  symbol: string,
  quantity: number,
  price: number,
): BookTransaction => ({ executed_at: `${date}T15:00:00Z`, type, symbol, quantity, price })

describe('reconstructBookHistory', () => {
  it('values the book BEFORE each day\'s activity, and lands the flow right after', () => {
    // calculateTWR's convention: a snapshot is the book before that day's
    // trades; a flow dated D belongs to the period that opens at snapshot D.
    const { snapshots, flows } = reconstructBookHistory([t('2026-01-12', 'buy', 'AAPL', 10, 100)], {
      AAPL: { '2026-01-12': 100, '2026-01-13': 110 },
    })
    expect(snapshots).toEqual([
      { date: '2026-01-12', value: 0 },
      { date: '2026-01-13', value: 1100 },
    ])
    expect(flows).toEqual([{ date: '2026-01-12', amount: 1000 }])
    expect(calculateTWR(snapshots, flows)).toBeCloseTo(10, 10)
  })

  it('uses the holdings of each date, not today\'s holdings', () => {
    const { snapshots } = reconstructBookHistory(
      [t('2026-01-12', 'buy', 'AAPL', 10, 100), t('2026-01-14', 'buy', 'AAPL', 30, 100)],
      { AAPL: { '2026-01-12': 100, '2026-01-13': 100, '2026-01-14': 100, '2026-01-15': 100 } },
    )
    expect(snapshots.map((s) => s.value)).toEqual([0, 1000, 1000, 4000])
  })

  it('does not count a purchase mid-window as performance', () => {
    const history = reconstructBookHistory(
      [
        t('2026-01-12', 'buy', 'AAPL', 10, 100),
        // Bought above the close: execution slippage, not the book's return.
        t('2026-01-14', 'buy', 'AAPL', 10, 105),
      ],
      { AAPL: { '2026-01-12': 100, '2026-01-13': 100, '2026-01-14': 100, '2026-01-15': 110, '2026-01-16': 110 } },
    )
    // Flat until the 15th, then +10% on a book that is by then twice as big.
    expect(calculateTWR(history.snapshots, history.flows)).toBeCloseTo(10, 10)
  })

  it('survives a full sell instead of collapsing the chain', () => {
    // Sold all 10 at 125 on a day that closed at 118. Valuing that flow at the
    // sale price would leave 1180 - 1250 = -70 of "opening capital" for a
    // period that ends at 0, and calculateTWR would return null or -100%.
    const history = reconstructBookHistory(
      [t('2026-01-12', 'buy', 'AAPL', 10, 100), t('2026-01-14', 'sell', 'AAPL', 10, 125)],
      { AAPL: { '2026-01-12': 100, '2026-01-13': 120, '2026-01-14': 118, '2026-01-15': 130 } },
    )
    expect(history.snapshots.at(-1)).toEqual({ date: '2026-01-15', value: 0 })
    // +20% then 118/120 while held; nothing after.
    expect(calculateTWR(history.snapshots, history.flows)).toBeCloseTo((1.2 * (118 / 120) - 1) * 100, 10)
  })

  it('values a flow on a non-trading day at the last close before it', () => {
    const history = reconstructBookHistory(
      [t('2026-01-09', 'buy', 'AAPL', 10, 100), t('2026-01-10', 'buy', 'AAPL', 10, 99)],
      { AAPL: { '2026-01-09': 100, '2026-01-12': 110 } },
    )
    expect(history.flows).toEqual([
      { date: '2026-01-09', amount: 1000 },
      { date: '2026-01-10', amount: 1000 },
    ])
    expect(calculateTWR(history.snapshots, history.flows)).toBeCloseTo(10, 10)
  })

  it('counts holdings bought before the window in its first snapshot', () => {
    const { snapshots, flows } = reconstructBookHistory(
      [t('2025-06-01', 'buy', 'AAPL', 10, 50)],
      { AAPL: { '2025-06-02': 50, '2026-01-12': 100, '2026-01-13': 105 } },
      { from: '2026-01-01' },
    )
    expect(snapshots[0]).toEqual({ date: '2026-01-12', value: 1000 })
    expect(flows).toEqual([])
  })

  it('values a symbol with no close yet at the price it traded at', () => {
    const { snapshots } = reconstructBookHistory(
      [t('2026-01-12', 'buy', 'NEW', 4, 25), t('2026-01-12', 'buy', 'AAPL', 1, 100)],
      { AAPL: { '2026-01-12': 100, '2026-01-13': 100 } },
    )
    expect(snapshots[1]).toEqual({ date: '2026-01-13', value: 200 })
  })

  it('applies splits without a flow, and ignores dividends', () => {
    const { snapshots, flows } = reconstructBookHistory(
      [t('2026-01-12', 'buy', 'AAPL', 10, 100), t('2026-01-13', 'split', 'AAPL', 2, 0), t('2026-01-13', 'dividend', 'AAPL', 10, 1)],
      { AAPL: { '2026-01-12': 100, '2026-01-13': 50, '2026-01-14': 50 } },
    )
    expect(flows).toHaveLength(1)
    // The split takes effect before the 13th is valued: that close is already
    // the post-split price, and 10 shares at 50 would be a 50% fall that never
    // happened.
    expect(snapshots.map((x) => x.value)).toEqual([0, 1000, 1000])
  })

  it('returns nothing to measure without transactions or prices', () => {
    expect(reconstructBookHistory([], { AAPL: { '2026-01-12': 1 } })).toEqual({ snapshots: [], flows: [], symbolSnapshots: [], symbolFlows: [] })
    expect(reconstructBookHistory([t('2026-01-12', 'buy', 'AAPL', 1, 1)], {}).snapshots).toEqual([])
  })
})

describe('regression: the returns route TWR', () => {
  // A normal history: three buys over two months and a partial sale.
  const transactions = [
    t('2026-04-06', 'buy', 'VOO', 1, 500),
    t('2026-04-20', 'buy', 'MSFT', 1, 400),
    t('2026-05-11', 'buy', 'VOO', 0.5, 520),
    t('2026-05-25', 'sell', 'MSFT', 0.4, 430),
  ]
  const dates: string[] = []
  for (let d = new Date('2026-04-06T00:00:00Z'); d <= new Date('2026-06-05T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) dates.push(d.toISOString().slice(0, 10))
  }
  const prices = {
    VOO: Object.fromEntries(dates.map((date, i) => [date, 500 + i * 1.2])),
    MSFT: Object.fromEntries(dates.map((date, i) => [date, 400 + i * 0.9])),
  }

  it('was null with today\'s quantities and XIRR-signed flows', () => {
    // What the route did: every date valued at the CURRENT holdings, and buys
    // passed as negative amounts to a function that expects deposits positive.
    const current = { VOO: 1.5, MSFT: 0.6 }
    const oldSnapshots = dates.map((date) => ({
      date,
      value: current.VOO * prices.VOO[date] + current.MSFT * prices.MSFT[date],
    }))
    const oldFlows = transactions.map((x) => ({
      date: x.executed_at.slice(0, 10),
      amount: x.type === 'buy' ? -x.quantity * x.price : x.quantity * x.price,
    }))
    const old = calculateTWR(oldSnapshots, oldFlows)
    expect(old === null || Math.abs(old) > 100).toBe(true)
  })

  it('is now a finite, plausible number', () => {
    const { snapshots, flows } = reconstructBookHistory(transactions, prices)
    const twr = calculateTWR(snapshots, flows)
    expect(twr).not.toBeNull()
    expect(Number.isFinite(twr!)).toBe(true)
    // VOO rose about 10% and MSFT about 9% over the window.
    expect(twr!).toBeGreaterThan(5)
    expect(twr!).toBeLessThan(12)
  })

  it('leaves MWR on its own investor-convention flows, unchanged', () => {
    const investorFlows = transactions.map((x) => ({
      date: x.executed_at.slice(0, 10),
      amount: x.type === 'buy' ? -x.quantity * x.price : x.quantity * x.price,
    }))
    const last = dates[dates.length - 1]
    const currentValue = 1.5 * prices.VOO[last] + 0.6 * prices.MSFT[last]
    expect(Number.isFinite(calculateMWR(investorFlows, currentValue, new Date(`${last}T00:00:00Z`))!)).toBe(true)
  })
})

describe('reconstructBookHistory by holding (P2-4)', () => {
  const prices = {
    AAPL: { '2026-03-02': 100, '2026-03-03': 110, '2026-03-04': 121 },
    MSFT: { '2026-03-02': 50, '2026-03-03': 50, '2026-03-04': 45 },
  }
  const history = reconstructBookHistory(
    [
      t('2026-03-02', 'buy', 'AAPL', 1, 100),
      t('2026-03-02', 'buy', 'MSFT', 2, 50),
      t('2026-03-03', 'buy', 'AAPL', 1, 110),
      t('2026-03-04', 'sell', 'MSFT', 2, 45),
    ],
    prices,
  )

  it('splits every snapshot by holding, and the parts add up to the whole', () => {
    expect(history.symbolSnapshots.map((s) => s.date)).toEqual(history.snapshots.map((s) => s.date))
    history.symbolSnapshots.forEach((split, i) => {
      const sum = Object.values(split.values).reduce((a, b) => a + b, 0)
      expect(sum).toBeCloseTo(history.snapshots[i].value, 10)
    })
    // Before 03-03's trade: one AAPL at 110 and two MSFT at 50.
    expect(history.symbolSnapshots[1].values).toEqual({ AAPL: 110, MSFT: 100 })
  })

  it('splits every flow by holding, with the same sign and valuation', () => {
    expect(history.symbolFlows).toEqual([
      { date: '2026-03-02', symbol: 'AAPL', amount: 100 },
      { date: '2026-03-02', symbol: 'MSFT', amount: 100 },
      { date: '2026-03-03', symbol: 'AAPL', amount: 110 },
      { date: '2026-03-04', symbol: 'MSFT', amount: -90 },
    ])
    expect(history.symbolFlows.map((f) => f.amount)).toEqual(history.flows.map((f) => f.amount))
  })
})

describe('snapshotsCoverWindow', () => {
  const nights = (portfolio_id: string, dates: string[]) => dates.map((snapshot_date) => ({ portfolio_id, snapshot_date }))

  it('does not let a few nights of snapshots stand in for a month', () => {
    // Two portfolios, four nights: eight rows, which the old ">= 7 rows" rule took as enough.
    const rows = [
      ...nights('a', ['2026-09-12', '2026-09-13', '2026-09-14', '2026-09-15']),
      ...nights('b', ['2026-09-12', '2026-09-13', '2026-09-14', '2026-09-15']),
    ]
    expect(snapshotsCoverWindow(rows, ['a', 'b'], '2026-08-16')).toBe(false)
  })

  it('accepts snapshots that start with the window, allowing a weekend', () => {
    const rows = [...nights('a', ['2026-08-18', '2026-08-19']), ...nights('b', ['2026-08-16', '2026-08-17'])]
    expect(snapshotsCoverWindow(rows, ['a', 'b'], '2026-08-16')).toBe(true)
    expect(snapshotsCoverWindow(rows, ['a', 'b'], '2026-08-14')).toBe(false)
  })

  it('needs every portfolio, not just one', () => {
    expect(snapshotsCoverWindow(nights('a', ['2026-08-16']), ['a', 'b'], '2026-08-16')).toBe(false)
    expect(snapshotsCoverWindow([], [], '2026-08-16')).toBe(false)
  })
})
