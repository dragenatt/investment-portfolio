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
})
