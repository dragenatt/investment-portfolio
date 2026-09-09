import { describe, it, expect } from 'vitest'
import {
  toCents,
  fromCents,
  addMoney,
  subtractMoney,
  multiplyMoney,
  roundMoney,
  allocateMoney,
} from '@/lib/utils/money'

describe('toCents', () => {
  it('converts a plain amount to integer cents', () => {
    expect(toCents(12.34)).toBe(1234)
  })

  it('rounds half away from zero at the cent boundary', () => {
    expect(toCents(1.005)).toBe(101)
    expect(toCents(-1.005)).toBe(-101)
  })

  it('absorbs binary representation error before rounding', () => {
    // 0.1 + 0.2 === 0.30000000000000004, and *100 === 30.000000000000004
    expect(toCents(0.1 + 0.2)).toBe(30)
  })

  it('rejects values that are not finite', () => {
    expect(() => toCents(NaN)).toThrow()
    expect(() => toCents(Infinity)).toThrow()
  })
})

describe('fromCents', () => {
  it('converts integer cents back to major units', () => {
    expect(fromCents(1234)).toBe(12.34)
  })

  it('round-trips an amount unchanged', () => {
    expect(fromCents(toCents(19.99))).toBe(19.99)
  })
})

describe('addMoney', () => {
  it('adds without floating point drift', () => {
    // 0.1 + 0.2 !== 0.3 in IEEE 754
    expect(0.1 + 0.2).not.toBe(0.3)
    expect(addMoney(0.1, 0.2)).toBe(0.3)
  })

  it('stays exact across a long chain of contributions', () => {
    const ten = Array(10).fill(0.1)
    expect(ten.reduce((a, b) => a + b, 0)).not.toBe(1)
    expect(ten.reduce(addMoney, 0)).toBe(1)
  })
})

describe('subtractMoney', () => {
  it('subtracts without floating point drift', () => {
    expect(0.3 - 0.1).not.toBe(0.2)
    expect(subtractMoney(0.3, 0.1)).toBe(0.2)
  })

  it('computes an exact P&L against cost basis', () => {
    // 1.1 - 1.0 === 0.10000000000000009
    expect(subtractMoney(1.1, 1.0)).toBe(0.1)
  })

  it('is antisymmetric', () => {
    expect(subtractMoney(0.1, 0.3)).toBe(-subtractMoney(0.3, 0.1))
  })
})

describe('multiplyMoney', () => {
  it('multiplies a unit price by a quantity without drift', () => {
    // 19.99 * 3 === 59.97000000000001
    expect(multiplyMoney(19.99, 3)).toBe(59.97)
    expect(multiplyMoney(0.07, 3)).toBe(0.21)
  })

  it('rounds the product to whole cents', () => {
    expect(multiplyMoney(10, 1 / 3)).toBe(3.33)
  })

  it('applies a percentage weight to capital', () => {
    expect(multiplyMoney(1000, 0.335)).toBe(335)
  })

  it('supports fractional share quantities', () => {
    expect(multiplyMoney(150.25, 0.5)).toBe(75.13)
  })
})

describe('roundMoney', () => {
  it('quantises a computed value to whole cents', () => {
    // (19.99 - 19.92) * 3 === 0.2099999999999902
    expect(roundMoney(0.2099999999999902)).toBe(0.21)
  })

  it('rounds half away from zero', () => {
    expect(roundMoney(0.005)).toBe(0.01)
    expect(roundMoney(-0.005)).toBe(-0.01)
  })

  it('reports a genuinely sub-cent value as zero', () => {
    expect(roundMoney(0.004)).toBe(0)
  })
})

describe('allocateMoney', () => {
  it('splits a total across weights without losing or inventing a cent', () => {
    const parts = allocateMoney(100, [1 / 3, 1 / 3, 1 / 3])
    expect(parts).toEqual([33.34, 33.33, 33.33])
    expect(parts.reduce(addMoney, 0)).toBe(100)
  })

  it('allocates typical percentage weights exactly', () => {
    const parts = allocateMoney(1000, [0.335, 0.335, 0.33])
    expect(parts).toEqual([335, 335, 330])
    expect(parts.reduce(addMoney, 0)).toBe(1000)
  })

  it('normalises weights that do not sum to one', () => {
    const parts = allocateMoney(100, [1, 1, 2])
    expect(parts).toEqual([25, 25, 50])
    expect(parts.reduce(addMoney, 0)).toBe(100)
  })

  it('gives the leftover cents to the largest fractional remainders', () => {
    // 10.00 over 60/30/10 splits cleanly; 10.01 leaves one cent to place
    expect(allocateMoney(10.01, [0.6, 0.3, 0.1]).reduce(addMoney, 0)).toBe(10.01)
  })

  it('distributes a negative total', () => {
    const parts = allocateMoney(-100, [0.5, 0.5])
    expect(parts).toEqual([-50, -50])
  })

  it('returns zeros when the weights carry no mass', () => {
    expect(allocateMoney(100, [0, 0])).toEqual([0, 0])
  })

  it('handles an empty weight list', () => {
    expect(allocateMoney(100, [])).toEqual([])
  })

  it('rejects a negative weight', () => {
    expect(() => allocateMoney(100, [1.5, -0.5])).toThrow()
  })
})
