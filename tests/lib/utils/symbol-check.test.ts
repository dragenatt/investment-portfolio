import { describe, it, expect } from 'vitest'
import { checkSymbols, quoteCandidates } from '@/lib/utils/symbol-check'

// Six holdings in production were imported under symbols no provider knows —
// Mexican tickers without ".MX" among them — and have been valued at cost ever
// since, with nothing on screen saying why. Synthetic tickers and prices.

describe('quoteCandidates', () => {
  it('also tries the BMV spelling of a bare ticker', () => {
    expect(quoteCandidates('femsaubd')).toEqual(['FEMSAUBD', 'FEMSAUBD.MX'])
  })

  it('leaves a symbol that already names its market alone', () => {
    expect(quoteCandidates('WALMEX.MX')).toEqual(['WALMEX.MX'])
    expect(quoteCandidates('BTC-USD')).toEqual(['BTC-USD'])
    expect(quoteCandidates('^GSPC')).toEqual(['^GSPC'])
  })
})

describe('checkSymbols', () => {
  const quotes = {
    AAA: { price: 10 },
    'BBB.MX': { price: 20 },
    DDD: { price: null },
  }

  it('sorts symbols into priced, priced under another spelling, and unknown', () => {
    expect(checkSymbols(['AAA', 'BBB', 'CCC', 'DDD'], quotes)).toEqual({
      quoted: ['AAA'],
      suggestions: { BBB: 'BBB.MX' },
      unknown: ['CCC', 'DDD'],
    })
  })

  it('reports each symbol once however many rows carry it', () => {
    expect(checkSymbols(['CCC', 'CCC', 'CCC'], quotes).unknown).toEqual(['CCC'])
  })

  it('prefers the symbol as written when it already prices', () => {
    expect(checkSymbols(['AAA'], { AAA: { price: 1 }, 'AAA.MX': { price: 2 } })).toEqual({
      quoted: ['AAA'],
      suggestions: {},
      unknown: [],
    })
  })
})
