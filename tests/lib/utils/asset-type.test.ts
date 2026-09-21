import { describe, it, expect } from 'vitest'
import { detectAssetType } from '@/lib/utils/asset-type'

// Twelve Data reports real-estate trusts with instrument_type "REIT". They were
// filed as bonds, and the allocation showed them as fixed income.

describe('detectAssetType', () => {
  it('records a REIT as the listed equity it is, not as a bond', () => {
    expect(detectAssetType('REIT')).toBe('stock')
  })

  it('still records bonds and debt as bonds', () => {
    expect(detectAssetType('Bond')).toBe('bond')
    expect(detectAssetType('Corporate Debt')).toBe('bond')
  })

  it('keeps the other provider types where they were', () => {
    expect(detectAssetType('Common Stock')).toBe('stock')
    expect(detectAssetType('EQUITY')).toBe('stock')
    expect(detectAssetType('ETF')).toBe('etf')
    expect(detectAssetType('Mutual Fund')).toBe('etf')
    expect(detectAssetType('Digital Currency')).toBe('crypto')
    expect(detectAssetType('Physical Currency')).toBe('forex')
    expect(detectAssetType('INDEX')).toBe('index')
    expect(detectAssetType(undefined, '^GSPC')).toBe('index')
    expect(detectAssetType(undefined)).toBe('stock')
  })
})
