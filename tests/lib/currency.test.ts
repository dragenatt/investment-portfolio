import { describe, it, expect } from 'vitest'
import { formatCurrency, convertCurrency } from '@/lib/utils/currency'

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

describe('convertCurrency', () => {
  it('converts USD to MXN', () => {
    const rates = { USD: 1, MXN: 17.5, EUR: 0.92 }
    expect(convertCurrency(100, 'USD', 'MXN', rates)).toBeCloseTo(1750)
  })
  it('returns same amount for same currency', () => {
    const rates = { USD: 1, MXN: 17.5, EUR: 0.92 }
    expect(convertCurrency(100, 'USD', 'USD', rates)).toBe(100)
  })
})
