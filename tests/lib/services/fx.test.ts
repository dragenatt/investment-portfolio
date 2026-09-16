import { describe, it, expect } from 'vitest'
import { buildConversion, fxPairSymbol, rateOn } from '@/lib/services/fx'

describe('fxPairSymbol', () => {
  it('names the USD pair the providers use, and nothing for USD itself', () => {
    expect(fxPairSymbol('MXN')).toBe('USDMXN=X')
    expect(fxPairSymbol('eur')).toBe('USDEUR=X')
    expect(fxPairSymbol('USD')).toBeNull()
    expect(fxPairSymbol('')).toBeNull()
  })
})

describe('rateOn', () => {
  const series = { '2026-03-02': 17.0, '2026-03-04': 17.2, '2026-03-05': 17.3 }

  it('takes the exact date when there is one', () => {
    expect(rateOn(series, '2026-03-04')).toBe(17.2)
  })

  it('carries the last known rate forward across a day the FX market skipped', () => {
    expect(rateOn(series, '2026-03-03')).toBe(17.0)
    expect(rateOn(series, '2026-06-01')).toBe(17.3)
  })

  it('reaches backward only when there is nothing earlier at all', () => {
    expect(rateOn(series, '2026-01-01')).toBe(17.0)
  })

  it('has no answer without a series, and refuses a nonsense rate', () => {
    expect(rateOn(undefined, '2026-03-04')).toBeNull()
    expect(rateOn({ '2026-03-04': 0 }, '2026-03-04')).toBeNull()
    expect(rateOn({ '2026-03-04': Number.NaN }, '2026-03-04')).toBeNull()
  })
})

describe('buildConversion', () => {
  const usdRates = {
    MXN: { '2026-03-02': 17.0, '2026-03-03': 17.5 },
    JPY: { '2026-03-02': 150 },
  }

  it('leaves a holding already in the base currency alone', () => {
    const c = buildConversion({ currencyBySymbol: { AAA: 'MXN' }, base: 'MXN', usdRates })
    expect(c.factor('AAA', '2026-03-02')).toBe(1)
  })

  it('converts a dollar holding into pesos at that date rate', () => {
    const c = buildConversion({ currencyBySymbol: { AAA: 'USD' }, base: 'MXN', usdRates })
    expect(c.factor('AAA', '2026-03-02')).toBeCloseTo(17.0, 12)
    // The next day the peso is weaker, so the same dollar holding is worth more.
    expect(c.factor('AAA', '2026-03-03')).toBeCloseTo(17.5, 12)
  })

  it('converts a peso holding into dollars', () => {
    const c = buildConversion({ currencyBySymbol: { AAA: 'MXN' }, base: 'USD', usdRates })
    expect(c.factor('AAA', '2026-03-02')).toBeCloseTo(1 / 17.0, 12)
  })

  it('crosses two non-base currencies through the dollar', () => {
    // 150 yen per dollar, 17 pesos per dollar → one yen is 17/150 pesos.
    const c = buildConversion({ currencyBySymbol: { NIK: 'JPY' }, base: 'MXN', usdRates })
    expect(c.factor('NIK', '2026-03-02')).toBeCloseTo(17.0 / 150, 12)
  })

  it('round-trips: converting there and back is the identity', () => {
    const toMxn = buildConversion({ currencyBySymbol: { AAA: 'USD' }, base: 'MXN', usdRates })
    const toUsd = buildConversion({ currencyBySymbol: { AAA: 'MXN' }, base: 'USD', usdRates })
    expect(toMxn.factor('AAA', '2026-03-02') * toUsd.factor('AAA', '2026-03-02')).toBeCloseTo(1, 12)
  })

  it('reports a symbol whose currency nobody knows, and leaves its number untouched', () => {
    const c = buildConversion({ currencyBySymbol: {}, base: 'MXN', usdRates })
    expect(c.factor('MYSTERY', '2026-03-02')).toBe(1)
    expect(c.unknownCurrency).toEqual(['MYSTERY'])
    expect(c.missingRate).toEqual([])
  })

  it('reports a currency it knows but has no rate for', () => {
    const c = buildConversion({ currencyBySymbol: { BRA: 'BRL' }, base: 'MXN', usdRates })
    expect(c.factor('BRA', '2026-03-02')).toBe(1)
    expect(c.missingRate).toEqual(['BRA'])
    expect(c.unknownCurrency).toEqual([])
  })

  it('lists every currency involved, base included', () => {
    const c = buildConversion({ currencyBySymbol: { A: 'USD', B: 'JPY' }, base: 'MXN', usdRates })
    c.factor('A', '2026-03-02')
    c.factor('B', '2026-03-02')
    expect(c.currencies.sort()).toEqual(['JPY', 'MXN', 'USD'])
  })

  it('never returns a factor that is not a usable number', () => {
    const c = buildConversion({
      currencyBySymbol: { A: 'USD', B: 'MXN', C: 'ZZZ' },
      base: 'MXN',
      usdRates: { MXN: { '2026-03-02': 17 }, ZZZ: { '2026-03-02': 0 } },
    })
    for (const symbol of ['A', 'B', 'C']) {
      const f = c.factor(symbol, '2026-03-02')
      expect(Number.isFinite(f)).toBe(true)
      expect(f).toBeGreaterThan(0)
    }
  })
})
