import { describe, it, expect } from 'vitest'
import { recalculatePosition } from '@/lib/services/transaction'

describe('recalculatePosition', () => {
  it('calculates avg cost for single buy', () => {
    const txns = [{ type: 'buy' as const, quantity: 10, price: 100, fees: 0 }]
    const result = recalculatePosition(txns)
    expect(result.quantity).toBe(10)
    expect(result.avg_cost).toBe(100)
  })

  it('calculates weighted avg cost for multiple buys', () => {
    const txns = [
      { type: 'buy' as const, quantity: 10, price: 100, fees: 0 },
      { type: 'buy' as const, quantity: 5, price: 200, fees: 0 },
    ]
    const result = recalculatePosition(txns)
    expect(result.quantity).toBe(15)
    expect(result.avg_cost).toBeCloseTo(133.33, 1)
  })

  it('handles sell — reduces quantity, keeps avg cost', () => {
    const txns = [
      { type: 'buy' as const, quantity: 10, price: 100, fees: 0 },
      { type: 'sell' as const, quantity: 3, price: 150, fees: 0 },
    ]
    const result = recalculatePosition(txns)
    expect(result.quantity).toBe(7)
    expect(result.avg_cost).toBe(100)
  })

  it('handles split — doubles quantity, halves avg cost', () => {
    const txns = [
      { type: 'buy' as const, quantity: 10, price: 100, fees: 0 },
      { type: 'split' as const, quantity: 2, price: 0, fees: 0 },
    ]
    const result = recalculatePosition(txns)
    expect(result.quantity).toBe(20)
    expect(result.avg_cost).toBe(50)
  })

  it('handles dividend — no change to position', () => {
    const txns = [
      { type: 'buy' as const, quantity: 10, price: 100, fees: 0 },
      { type: 'dividend' as const, quantity: 0, price: 5, fees: 0 },
    ]
    const result = recalculatePosition(txns)
    expect(result.quantity).toBe(10)
    expect(result.avg_cost).toBe(100)
  })

  it('includes fees in avg_cost calculation', () => {
    const txns = [
      { type: 'buy' as const, quantity: 10, price: 100, fees: 50 },
    ]
    const result = recalculatePosition(txns)
    expect(result.quantity).toBe(10)
    // totalCost = 10*100 + 50 = 1050, avg = 105
    expect(result.avg_cost).toBeCloseTo(105)
  })

  it('includes fees across multiple buys', () => {
    const txns = [
      { type: 'buy' as const, quantity: 10, price: 100, fees: 10 },
      { type: 'buy' as const, quantity: 10, price: 200, fees: 20 },
    ]
    const result = recalculatePosition(txns)
    expect(result.quantity).toBe(20)
    // first buy: totalCost = 1010, avg = 101
    // second buy: totalCost = 10*101 + 10*200 + 20 = 1010 + 2020 = 3030
    // avg = 3030/20 = 151.5
    expect(result.avg_cost).toBeCloseTo(151.5)
  })

  describe('edge cases', () => {
    it('returns zero for empty transactions', () => {
      const result = recalculatePosition([])
      expect(result.quantity).toBe(0)
      expect(result.avg_cost).toBe(0)
    })

    it('clamps quantity to zero when selling more than held', () => {
      const txns = [
        { type: 'buy' as const, quantity: 5, price: 100, fees: 0 },
        { type: 'sell' as const, quantity: 10, price: 100, fees: 0 },
      ]
      const result = recalculatePosition(txns)
      expect(result.quantity).toBe(0)
      expect(result.avg_cost).toBe(0)
    })

    it('handles zero quantity buy', () => {
      const txns = [
        { type: 'buy' as const, quantity: 0, price: 100, fees: 0 },
      ]
      const result = recalculatePosition(txns)
      expect(result.quantity).toBe(0)
      expect(result.avg_cost).toBe(0)
    })

    it('handles sell after full sell (quantity already zero)', () => {
      const txns = [
        { type: 'buy' as const, quantity: 10, price: 100, fees: 0 },
        { type: 'sell' as const, quantity: 10, price: 120, fees: 0 },
        { type: 'sell' as const, quantity: 5, price: 130, fees: 0 },
      ]
      const result = recalculatePosition(txns)
      expect(result.quantity).toBe(0)
      expect(result.avg_cost).toBe(0)
    })

    it('handles complex sequence: buy, buy, sell, split, dividend', () => {
      const txns = [
        { type: 'buy' as const, quantity: 100, price: 50, fees: 10 },
        { type: 'buy' as const, quantity: 50, price: 60, fees: 5 },
        { type: 'sell' as const, quantity: 30, price: 70, fees: 0 },
        { type: 'split' as const, quantity: 2, price: 0, fees: 0 },
        { type: 'dividend' as const, quantity: 0, price: 2, fees: 0 },
      ]
      const result = recalculatePosition(txns)
      expect(result.quantity).toBe(240)
      expect(result.avg_cost).toBeGreaterThan(0)
    })
  })
})

describe('recalculatePosition — money precision (P0-3)', () => {
  it('accumulates cost basis without floating point drift', () => {
    // 0.1 + 0.2 === 0.30000000000000004, so avg_cost drifts to 0.15000000000000002
    const r = recalculatePosition([
      { type: 'buy', quantity: 1, price: 0.1, fees: 0 },
      { type: 'buy', quantity: 1, price: 0.2, fees: 0 },
    ])
    expect(r.quantity).toBe(2)
    expect(r.avg_cost).toBe(0.15)
  })

  it('folds commissions into the cost basis exactly', () => {
    const r = recalculatePosition([{ type: 'buy', quantity: 1, price: 0.1, fees: 0.2 }])
    expect(r.avg_cost).toBe(0.3)
  })

  it('keeps a many-trade cost basis exact', () => {
    const txns = Array(10).fill({ type: 'buy' as const, quantity: 1, price: 0.1, fees: 0 })
    expect(recalculatePosition(txns).avg_cost).toBe(0.1)
  })
})

describe('recalculatePosition — quantities and dust', () => {
  const buy = (quantity: number, price: number) => ({ type: 'buy' as const, quantity, price, fees: 0 })
  const sell = (quantity: number, price: number) => ({ type: 'sell' as const, quantity, price, fees: 0 })

  it('closes the real RBLX position that was sold down to 0.000003 shares', () => {
    // The trade modal stores six decimals, the positions table shows four:
    // the user sold the 78.8022 they could see and 0.000003 stayed behind,
    // worth $0.0001, counted as a holding by every analytic.
    const result = recalculatePosition([
      buy(39.401103, 38.07),
      buy(39.4011, 38.63),
      sell(75.8022, 38.63),
      sell(3, 38.63),
    ])
    expect(result.quantity).toBe(0)
    expect(result.avg_cost).toBe(0)
  })

  it('leaves exactly zero after selling everything', () => {
    const result = recalculatePosition([buy(0.1, 100), buy(0.2, 100), sell(0.3, 100)])
    expect(result.quantity).toBe(0)
  })

  it('keeps partial sells exact to the decimal', () => {
    const result = recalculatePosition([buy(10.123456, 50), sell(3.1, 55), sell(2.02, 60)])
    expect(result.quantity).toBe(5.003456)
  })

  it('keeps a small remainder that is still worth something', () => {
    // 0.00004 BTC at $90,000 is $3.60 — not dust.
    const result = recalculatePosition([buy(1, 90_000), sell(0.99996, 90_000)])
    expect(result.quantity).toBe(0.00004)
    expect(result.avg_cost).toBeGreaterThan(0)
  })

  it('judges dust at the price of the sale that left it', () => {
    // 0.001 shares left: dust at $1, real money at $1,000.
    expect(recalculatePosition([buy(1, 1), sell(0.999, 1)]).quantity).toBe(0)
    expect(recalculatePosition([buy(1, 1000), sell(0.999, 1000)]).quantity).toBe(0.001)
  })

  it('does not erase a deliberately tiny purchase', () => {
    // Dust is what a sale leaves behind, not what someone chose to buy.
    expect(recalculatePosition([buy(0.00001, 38)]).quantity).toBe(0.00001)
  })

  it('does not let an oversold replay carry a negative quantity into later buys', () => {
    // Buy 5, sell 10 (possible after editing an earlier buy down), buy 10.
    // The old replay went to -5 and the final buy landed at 5.
    const result = recalculatePosition([buy(5, 100), sell(10, 100), buy(10, 120)])
    expect(result.quantity).toBe(10)
    expect(result.avg_cost).toBe(120)
  })

  it('rounds the result of a split', () => {
    const result = recalculatePosition([buy(3, 90), { type: 'split' as const, quantity: 1 / 3, price: 0, fees: 0 }])
    expect(result.quantity).toBe(1)
    expect(result.avg_cost).toBe(270)
  })
})
