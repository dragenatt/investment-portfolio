import { describe, it, expect } from 'vitest'
import { deriveTradeHistory, type RawTransaction } from '@/lib/services/trade-history'

const tx = (
  type: RawTransaction['type'],
  quantity: number,
  price: number,
  executed_at: string,
  fees = 0,
): RawTransaction => ({ type, quantity, price, fees, currency: 'USD', executed_at })

describe('deriveTradeHistory — cost basis', () => {
  it('folds the fee into the cost basis of a purchase', () => {
    // 10 x 100 + 5 = 1,005 for 10 shares
    const result = deriveTradeHistory([tx('buy', 10, 100, '2025-01-01', 5)], 110)!
    expect(result.quantity).toBe(10)
    expect(result.avgCost).toBeCloseTo(100.5, 6)
    expect(result.costBasis).toBe(1005)
  })

  it('averages two purchases at different prices', () => {
    const result = deriveTradeHistory(
      [tx('buy', 10, 100, '2025-01-01'), tx('buy', 10, 120, '2025-06-01')],
      130,
    )!
    expect(result.quantity).toBe(20)
    expect(result.avgCost).toBeCloseTo(110, 6)
  })

  it('leaves the average cost unchanged by a sale', () => {
    // Selling realises a gain; it does not re-price what is left
    const result = deriveTradeHistory(
      [tx('buy', 10, 100, '2025-01-01', 5), tx('sell', 5, 120, '2025-06-01', 2)],
      130,
    )!
    expect(result.quantity).toBe(5)
    expect(result.avgCost).toBeCloseTo(100.5, 6)
  })
})

describe('deriveTradeHistory — realised and unrealised', () => {
  it('realises the gain on the shares actually sold, net of the exit fee', () => {
    // 5 sold at 120 = 600, less a 2 fee = 598. Cost of those 5 = 5 x 100.5 = 502.5
    const result = deriveTradeHistory(
      [tx('buy', 10, 100, '2025-01-01', 5), tx('sell', 5, 120, '2025-06-01', 2)],
      130,
    )!
    expect(result.realizedPnl).toBeCloseTo(95.5, 6)
  })

  it('realises a loss as a negative number', () => {
    const result = deriveTradeHistory(
      [tx('buy', 10, 100, '2025-01-01'), tx('sell', 10, 80, '2025-06-01')],
      80,
    )!
    expect(result.realizedPnl).toBeCloseTo(-200, 6)
  })

  it('marks the remaining position to market', () => {
    const result = deriveTradeHistory(
      [tx('buy', 10, 100, '2025-01-01', 5), tx('sell', 5, 120, '2025-06-01', 2)],
      130,
    )!
    // 5 shares at 130 against a 100.5 basis
    expect(result.unrealizedPnl).toBeCloseTo(147.5, 6)
    expect(result.marketValue).toBe(650)
  })

  it('reports zero unrealised P&L for a fully closed position', () => {
    const result = deriveTradeHistory(
      [tx('buy', 10, 100, '2025-01-01'), tx('sell', 10, 120, '2025-06-01')],
      130,
    )!
    expect(result.quantity).toBe(0)
    expect(result.unrealizedPnl).toBe(0)
    expect(result.marketValue).toBe(0)
    expect(result.realizedPnl).toBeCloseTo(200, 6)
  })

  it('keeps total P&L equal to realised plus unrealised', () => {
    const result = deriveTradeHistory(
      [tx('buy', 10, 100, '2025-01-01', 5), tx('sell', 5, 120, '2025-06-01', 2)],
      130,
    )!
    expect(result.totalPnl).toBeCloseTo(result.realizedPnl + result.unrealizedPnl, 8)
  })
})

describe('deriveTradeHistory — fees, dividends and splits', () => {
  it('totals every fee paid', () => {
    const result = deriveTradeHistory(
      [tx('buy', 10, 100, '2025-01-01', 5), tx('sell', 5, 120, '2025-06-01', 2)],
      130,
    )!
    expect(result.totalFees).toBe(7)
  })

  it('counts dividends separately from realised trading gains', () => {
    const result = deriveTradeHistory(
      [tx('buy', 10, 100, '2025-01-01'), tx('dividend', 10, 2, '2025-06-01')],
      100,
    )!
    expect(result.dividendsReceived).toBe(20)
    expect(result.realizedPnl).toBe(0)
  })

  it('multiplies quantity and divides cost per share on a split', () => {
    // 2:1 split — twice the shares at half the cost each, same total invested
    const result = deriveTradeHistory(
      [tx('buy', 10, 100, '2025-01-01'), tx('split', 2, 0, '2025-06-01')],
      60,
    )!
    expect(result.quantity).toBe(20)
    expect(result.avgCost).toBeCloseTo(50, 6)
    expect(result.costBasis).toBe(1000)
  })
})

describe('deriveTradeHistory — returns', () => {
  it('builds cash flows with buys out and sells in', () => {
    const result = deriveTradeHistory(
      [tx('buy', 10, 100, '2025-01-01'), tx('sell', 5, 120, '2025-06-01')],
      130,
    )!
    expect(result.cashFlows[0].amount).toBeCloseTo(-1000)
    expect(result.cashFlows[1].amount).toBeCloseTo(600)
  })

  it('counts a dividend as money in', () => {
    const result = deriveTradeHistory(
      [tx('buy', 10, 100, '2025-01-01'), tx('dividend', 10, 2, '2025-06-01')],
      110,
    )!
    expect(result.cashFlows.find((f) => f.amount === 20)).toBeDefined()
  })

  it('computes a money-weighted return over the flows', () => {
    const result = deriveTradeHistory(
      [tx('buy', 10, 100, '2025-01-01')],
      120,
      { asOf: new Date('2026-01-01') },
    )!
    // 1,000 in, worth 1,200 a year later
    expect(result.mwrPct).toBeCloseTo(20, 0)
  })

  it('says it cannot compute a return when there is nothing to compute from', () => {
    const result = deriveTradeHistory([], 100)
    expect(result).toBeNull()
  })

  it('reports simple return against what was actually invested', () => {
    const result = deriveTradeHistory([tx('buy', 10, 100, '2025-01-01')], 120)!
    expect(result.simpleReturnPct).toBeCloseTo(20, 6)
  })

  it('counts sale proceeds, not the gain on them, in a part-sold position', () => {
    // 1,000 invested. Sold 5 at 120 for 600, still holding 5 worth 650.
    // The investor is up 25%: 1,250 back against 1,000 in. Summing the realised
    // GAIN (95.5) instead of the PROCEEDS (600) reports this as a 25% loss.
    const result = deriveTradeHistory(
      [tx('buy', 10, 100, '2025-01-01'), tx('sell', 5, 120, '2025-06-01')],
      130,
    )!
    expect(result.simpleReturnPct).toBeCloseTo(25, 6)
  })

  it('counts dividends as money returned', () => {
    const result = deriveTradeHistory(
      [tx('buy', 10, 100, '2025-01-01'), tx('dividend', 10, 5, '2025-06-01')],
      100,
    )!
    // 1,000 in, 50 paid out, 1,000 still held
    expect(result.simpleReturnPct).toBeCloseTo(5, 6)
  })
})

describe('deriveTradeHistory — robustness', () => {
  it('reads transactions in date order however they arrive', () => {
    const ordered = deriveTradeHistory(
      [tx('buy', 10, 100, '2025-01-01'), tx('sell', 5, 120, '2025-06-01')],
      130,
    )!
    const shuffled = deriveTradeHistory(
      [tx('sell', 5, 120, '2025-06-01'), tx('buy', 10, 100, '2025-01-01')],
      130,
    )!
    expect(shuffled.realizedPnl).toBeCloseTo(ordered.realizedPnl, 8)
    expect(shuffled.quantity).toBe(ordered.quantity)
  })

  it('never sells more than is held', () => {
    const result = deriveTradeHistory(
      [tx('buy', 5, 100, '2025-01-01'), tx('sell', 10, 120, '2025-06-01')],
      130,
    )!
    expect(result.quantity).toBe(0)
    expect(result.warnings.join(' ')).toMatch(/more than|sobrevend|held/i)
  })

  it('flags a sale with no purchase behind it rather than inventing a basis', () => {
    const result = deriveTradeHistory([tx('sell', 5, 120, '2025-06-01')], 130)!
    expect(result.warnings.length).toBeGreaterThan(0)
    expect(Number.isFinite(result.realizedPnl)).toBe(true)
  })

  it('keeps every monetary figure on whole cents', () => {
    const result = deriveTradeHistory(
      [tx('buy', 3, 33.33, '2025-01-01', 1.11), tx('sell', 1, 41.67, '2025-06-01', 0.99)],
      45.55,
    )!
    for (const value of [
      result.costBasis,
      result.realizedPnl,
      result.unrealizedPnl,
      result.totalPnl,
      result.marketValue,
      result.totalFees,
      result.dividendsReceived,
    ]) {
      expect(Math.round(value * 100) / 100).toBe(value)
    }
  })

  it('never emits a non-finite number', () => {
    const result = deriveTradeHistory(
      [tx('buy', 0, 0, '2025-01-01'), tx('sell', 0, 0, '2025-06-01')],
      0,
    )!
    for (const value of [result.avgCost, result.realizedPnl, result.unrealizedPnl]) {
      expect(Number.isFinite(value)).toBe(true)
    }
  })

  it('is deterministic', () => {
    const txs = [tx('buy', 10, 100, '2025-01-01', 5), tx('sell', 5, 120, '2025-06-01', 2)]
    const opts = { asOf: new Date('2026-01-01') }
    expect(deriveTradeHistory(txs, 130, opts)).toEqual(deriveTradeHistory(txs, 130, opts))
  })
})

describe('deriveTradeHistory — quantities and dust', () => {
  it('closes the real RBLX position instead of leaving 0.000003 shares open', () => {
    const result = deriveTradeHistory(
      [
        tx('buy', 39.401103, 38.07, '2026-08-18T18:00:00Z'),
        tx('buy', 39.4011, 38.63, '2026-08-21T18:00:00Z'),
        tx('sell', 75.8022, 38.63, '2026-08-21T18:00:00Z'),
        tx('sell', 3, 38.63, '2026-08-21T18:00:00Z'),
      ],
      45.5,
    )!
    expect(result.quantity).toBe(0)
    expect(result.costBasis).toBe(0)
    expect(result.unrealizedPnl).toBe(0)
  })

  it('agrees with recalculatePosition on the quantity left', () => {
    const result = deriveTradeHistory(
      [tx('buy', 10.123456, 50, '2025-01-01'), tx('sell', 3.1, 55, '2025-02-01'), tx('sell', 2.02, 60, '2025-03-01')],
      60,
    )!
    expect(result.quantity).toBe(5.003456)
  })

  it('releases the cost of the dust into the sale that closed it, so no cent goes missing', () => {
    const result = deriveTradeHistory([tx('buy', 1, 1, '2025-01-01'), tx('sell', 0.999, 1, '2025-02-01')], 1)!
    expect(result.quantity).toBe(0)
    expect(result.costBasis).toBe(0)
    // Paid $1.00, got $0.999 back -> -$0.00 (rounded), and nothing left on paper.
    expect(result.realizedPnl + result.unrealizedPnl).toBeCloseTo(-0.001, 2)
  })
})
