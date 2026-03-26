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
