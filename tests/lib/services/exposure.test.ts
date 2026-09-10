import { describe, it, expect } from 'vitest'
import {
  inferRegion,
  sectorExposure,
  geographicExposure,
  decomposeCurrencyReturn,
  currencyExposure,
  type ExposureHolding,
} from '@/lib/services/exposure'

const book: ExposureHolding[] = [
  { symbol: 'AAPL', value: 20000, sector: 'Technology', currency: 'USD' },
  { symbol: 'MSFT', value: 20000, sector: 'Technology', currency: 'USD' },
  { symbol: 'JPM', value: 15000, sector: 'Financials', currency: 'USD' },
  { symbol: 'WALMEX.MX', value: 25000, sector: 'Consumer Defensive', currency: 'MXN' },
  { symbol: 'BND', value: 20000, sector: null, currency: 'USD' },
]

describe('inferRegion', () => {
  it('trusts an explicit country above everything else', () => {
    const region = inferRegion({ symbol: 'AAPL', currency: 'USD', country: 'Mexico' })
    expect(region.region).toBe('Mexico')
    expect(region.basis).toBe('country')
  })

  it('reads a market suffix on the symbol', () => {
    expect(inferRegion({ symbol: 'WALMEX.MX', currency: 'USD' }).region).toBe('Mexico')
    expect(inferRegion({ symbol: 'SAP.DE', currency: 'USD' }).region).toBe('Europe')
    expect(inferRegion({ symbol: 'BP.L', currency: 'USD' }).region).toBe('Europe')
  })

  it('says the suffix is what it used', () => {
    expect(inferRegion({ symbol: 'WALMEX.MX', currency: 'USD' }).basis).toBe('symbol-suffix')
  })

  it('falls back to the currency when there is no suffix', () => {
    const region = inferRegion({ symbol: 'AAPL', currency: 'MXN' })
    expect(region.region).toBe('Mexico')
    expect(region.basis).toBe('currency')
  })

  it('reads a plain US symbol as United States', () => {
    expect(inferRegion({ symbol: 'AAPL', currency: 'USD' }).region).toBe('United States')
  })

  it('admits when it does not know', () => {
    const region = inferRegion({ symbol: 'XYZ', currency: 'JPY' })
    expect(region.region).toBe('Unknown')
    expect(region.basis).toBe('unknown')
  })

  it('never guesses from a currency that spans regions', () => {
    // A dollar-denominated ETF can hold anything, so the currency proves nothing
    // beyond a default; the basis has to say so.
    expect(inferRegion({ symbol: 'VT', currency: 'USD' }).basis).not.toBe('country')
  })
})

describe('sectorExposure', () => {
  it('groups holdings by sector and weights them', () => {
    const result = sectorExposure(book)
    const tech = result.buckets.find((b) => b.name === 'Technology')!
    expect(tech.weightPct).toBeCloseTo(40) // 40000 of 100000
    expect(tech.symbols).toEqual(['AAPL', 'MSFT'])
  })

  it('files a holding with no sector under Unknown rather than dropping it', () => {
    const result = sectorExposure(book)
    const unknown = result.buckets.find((b) => b.name === 'Unknown')!
    expect(unknown.weightPct).toBeCloseTo(20)
    expect(result.buckets.reduce((s, b) => s + b.weightPct, 0)).toBeCloseTo(100, 6)
  })

  it('ranks the largest exposure first', () => {
    const weights = sectorExposure(book).buckets.map((b) => b.weightPct)
    expect([...weights].sort((a, b) => b - a)).toEqual(weights)
  })

  it('flags a concentration no single ticker reveals', () => {
    // The roadmap case: AAPL 20% + MSFT 20% is 40% technology, and neither
    // position alone looks like a concentration
    const result = sectorExposure(book)
    expect(result.hiddenConcentration).not.toBeNull()
    expect(result.hiddenConcentration!.name).toBe('Technology')
    expect(result.hiddenConcentration!.message).toMatch(/AAPL/)
    expect(result.hiddenConcentration!.message).toMatch(/40/)
  })

  it('does not flag a concentration when no bucket is oversized', () => {
    const spread: ExposureHolding[] = Array.from({ length: 8 }, (_, i) => ({
      symbol: `S${i}`,
      value: 1000,
      sector: `Sector ${i}`,
      currency: 'USD',
    }))
    expect(sectorExposure(spread).hiddenConcentration).toBeNull()
  })

  it('does not call a single large position a hidden concentration', () => {
    // One holding at 60% is visible on any weights chart; nothing is hidden
    const single: ExposureHolding[] = [
      { symbol: 'AAPL', value: 60000, sector: 'Technology', currency: 'USD' },
      { symbol: 'JPM', value: 40000, sector: 'Financials', currency: 'USD' },
    ]
    expect(sectorExposure(single).hiddenConcentration).toBeNull()
  })

  it('handles an empty book', () => {
    const result = sectorExposure([])
    expect(result.buckets).toEqual([])
    expect(result.hiddenConcentration).toBeNull()
  })
})

describe('geographicExposure', () => {
  it('groups holdings by inferred region', () => {
    const result = geographicExposure(book)
    const us = result.buckets.find((b) => b.name === 'United States')!
    expect(us.weightPct).toBeCloseTo(75)
    const mx = result.buckets.find((b) => b.name === 'Mexico')!
    expect(mx.weightPct).toBeCloseTo(25)
  })

  it('reports how confident the grouping is', () => {
    const result = geographicExposure(book)
    // Most of this book resolves by currency alone, which proves nothing about
    // where the business is — the weakest basis there is, and it says so.
    expect(result.confidence).toBe('weak')
    expect(result.caveat.length).toBeGreaterThan(30)
  })

  it('weights sum to 100', () => {
    expect(
      geographicExposure(book).buckets.reduce((s, b) => s + b.weightPct, 0),
    ).toBeCloseTo(100, 6)
  })
})

describe('decomposeCurrencyReturn (P1-20)', () => {
  it('splits a return into the asset move and the exchange rate move', () => {
    // +10% in dollars while the dollar rose 5% against the peso
    const result = decomposeCurrencyReturn(0.1, 0.05)!
    expect(result.assetEffectPct).toBeCloseTo(10)
    expect(result.fxEffectPct).toBeCloseTo(5)
    expect(result.interactionPct).toBeCloseTo(0.5) // 0.10 * 0.05
    expect(result.totalPct).toBeCloseTo(15.5)
  })

  it('adds up exactly — the parts are the whole', () => {
    const result = decomposeCurrencyReturn(0.234, -0.081)!
    expect(result.assetEffectPct + result.fxEffectPct + result.interactionPct).toBeCloseTo(
      result.totalPct,
      10,
    )
  })

  it('matches the compounded return', () => {
    const result = decomposeCurrencyReturn(0.234, -0.081)!
    expect(result.totalPct / 100).toBeCloseTo(1.234 * 0.919 - 1, 10)
  })

  it('shows an asset gain wiped out by the exchange rate', () => {
    // Up 8% locally, but the local currency fell 10% — a loss in base terms
    const result = decomposeCurrencyReturn(0.08, -0.1)!
    expect(result.assetEffectPct).toBeGreaterThan(0)
    expect(result.totalPct).toBeLessThan(0)
  })

  it('is zero across the board when nothing moved', () => {
    const result = decomposeCurrencyReturn(0, 0)!
    expect(result.totalPct).toBe(0)
    expect(result.fxEffectPct).toBe(0)
  })

  it('refuses inputs that are not finite', () => {
    expect(decomposeCurrencyReturn(Number.NaN, 0)).toBeNull()
    expect(decomposeCurrencyReturn(0, Number.POSITIVE_INFINITY)).toBeNull()
  })

  it('explains which side did the work', () => {
    expect(decomposeCurrencyReturn(0.02, 0.2)!.summary).toMatch(/tipo de cambio|exchange/i)
    expect(decomposeCurrencyReturn(0.2, 0.01)!.summary).toMatch(/activo|asset/i)
  })
})

describe('currencyExposure', () => {
  it('groups the book by the currency it is denominated in', () => {
    const result = currencyExposure(book, 'MXN')
    const usd = result.buckets.find((b) => b.name === 'USD')!
    expect(usd.weightPct).toBeCloseTo(75)
  })

  it('separates the share exposed to a rate the base currency does not control', () => {
    const result = currencyExposure(book, 'MXN')
    expect(result.foreignPct).toBeCloseTo(75)
    expect(result.basePct).toBeCloseTo(25)
  })

  it('reports no currency risk for a single-currency book', () => {
    const result = currencyExposure(
      [{ symbol: 'WALMEX.MX', value: 100, sector: null, currency: 'MXN' }],
      'MXN',
    )
    expect(result.foreignPct).toBe(0)
    expect(result.summary).toMatch(/no/i)
  })

  it('handles an empty book', () => {
    expect(currencyExposure([], 'MXN').buckets).toEqual([])
  })
})
