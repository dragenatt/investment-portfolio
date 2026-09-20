import { describe, it, expect } from 'vitest'
import { formatCurrency, convertCurrency, canConvert } from '@/lib/utils/currency'

describe('formatCurrency', () => {
  it('formats MXN correctly', () => {
    expect(formatCurrency(1234.56, 'MXN')).toBe('$1,234.56 MXN')
  })
  it('formats USD correctly', () => {
    expect(formatCurrency(1234.56, 'USD')).toBe('$1,234.56 USD')
  })
  it('formats EUR correctly', () => {
    expect(formatCurrency(1234.56, 'EUR')).toBe('€1,234.56 EUR')
  })
})

const rates = { USD: 1, MXN: 17.5, EUR: 0.92 }

describe('convertCurrency', () => {
  it('converts USD to MXN', () => {
    const result = convertCurrency(100, 'USD', 'MXN', rates)
    expect(result.amount).toBeCloseTo(1750)
    expect(result.converted).toBe(true)
  })

  it('returns same amount for same currency', () => {
    expect(convertCurrency(100, 'USD', 'USD', rates)).toEqual({ amount: 100, converted: true })
  })

  it('says so when no rate joins the two currencies', () => {
    // A Nikkei position quotes in yen and there is no USDJPY rate. The amount
    // comes back untouched — it always did — but now it comes back labelled,
    // so a caller cannot add it to a peso total by accident.
    expect(convertCurrency(1200, 'JPY', 'MXN', rates)).toEqual({ amount: 1200, converted: false })
    expect(convertCurrency(50, 'MXN', 'BRL', rates)).toEqual({ amount: 50, converted: false })
  })

  it('treats a missing currency and a zero rate the same way', () => {
    expect(convertCurrency(10, 'USD', 'XYZ', { ...rates, XYZ: 0 }).converted).toBe(false)
  })
})

describe('canConvert', () => {
  it('is true for a pair with rates, and for a currency with itself', () => {
    expect(canConvert('USD', 'MXN', rates)).toBe(true)
    expect(canConvert('JPY', 'JPY', rates)).toBe(true)
  })

  it('is false when either side is missing', () => {
    expect(canConvert('JPY', 'MXN', rates)).toBe(false)
    expect(canConvert('MXN', 'JPY', rates)).toBe(false)
  })
})
