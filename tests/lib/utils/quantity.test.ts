import { describe, it, expect } from 'vitest'
import {
  QUANTITY_DECIMALS,
  DUST_VALUE,
  roundQuantity,
  addQuantity,
  subtractQuantity,
  multiplyQuantity,
  isDustRemainder,
} from '@/lib/utils/quantity'

describe('quantity arithmetic', () => {
  it('works to eight decimal places, enough for a satoshi', () => {
    expect(QUANTITY_DECIMALS).toBe(8)
    expect(addQuantity(0.00000001, 0.00000002)).toBe(0.00000003)
  })

  it('adds without binary drift', () => {
    expect(0.1 + 0.2).not.toBe(0.3)
    expect(addQuantity(0.1, 0.2)).toBe(0.3)
  })

  it('subtracts the real RBLX case to exactly what the decimals say', () => {
    // Bought 39.401103 + 39.4011, sold 75.8022 + 3. Plain floats leave
    // 0.000002999999992425728; the decimal answer is 0.000003.
    const held = addQuantity(39.401103, 39.4011)
    const left = subtractQuantity(subtractQuantity(held, 75.8022), 3)
    expect(left).toBe(0.000003)
  })

  it('rounds a drifted value back to its eight-decimal quantity', () => {
    expect(roundQuantity(0.000002999999992425728)).toBe(0.000003)
    expect(roundQuantity(78.80220000000001)).toBe(78.8022)
  })

  it('keeps large token quantities stable', () => {
    expect(addQuantity(5_000_000_000, 1.5)).toBe(5_000_000_001.5)
  })

  it('applies a split ratio and rounds the result', () => {
    expect(multiplyQuantity(3, 1 / 3)).toBe(1)
    expect(multiplyQuantity(10.12345678, 2)).toBe(20.24691356)
  })

  it('refuses a non-finite quantity rather than propagating it', () => {
    expect(() => roundQuantity(Number.NaN)).toThrow(RangeError)
  })
})

describe('isDustRemainder', () => {
  it('is half a cent, the smallest amount money.ts can represent', () => {
    expect(DUST_VALUE).toBe(0.005)
  })

  it('calls 0.000003 RBLX at $38.63 dust', () => {
    // Worth $0.000116: it rounds to $0.00 in every money figure in the app.
    expect(isDustRemainder(0.000003, 38.63)).toBe(true)
  })

  it('does not call a tiny but valuable quantity dust', () => {
    // 0.00004 BTC is $3.60 at $90,000. A fixed share epsilon would have erased it.
    expect(isDustRemainder(0.00004, 90_000)).toBe(false)
  })

  it('does not call an empty position dust', () => {
    expect(isDustRemainder(0, 38.63)).toBe(false)
  })

  it('cannot judge without a usable price, so says no', () => {
    expect(isDustRemainder(0.000003, Number.NaN)).toBe(false)
    expect(isDustRemainder(0.000003, 0)).toBe(false)
  })

  it('is exactly at the boundary: half a cent is not dust, just under is', () => {
    expect(isDustRemainder(0.005, 1)).toBe(false)
    expect(isDustRemainder(0.0049, 1)).toBe(true)
  })
})
