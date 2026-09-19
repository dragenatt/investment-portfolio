import { describe, it, expect } from 'vitest'
import { bookInBase } from '@/lib/services/book-currency'
import { buildConversion, currencyFactor } from '@/lib/services/fx'
import { reconstructBookHistory } from '@/lib/services/portfolio-history'
import { calculateTWR, calculateSimpleReturn } from '@/lib/services/returns'

// The returns tab compared units × a dollar close with units × a peso price and
// reported a book that had barely moved as down 94%. Synthetic figures only.

// One USD buys 20 MXN on the 1st and 18 MXN on the 2nd.
const usdRates = { MXN: { '2026-09-01': 20, '2026-09-02': 18 } }

describe('currencyFactor', () => {
  it('takes an amount into the base currency at its own date\'s rate', () => {
    expect(currencyFactor(usdRates, 'USD', 'MXN', '2026-09-01')).toBe(20)
    expect(currencyFactor(usdRates, 'USD', 'MXN', '2026-09-02')).toBe(18)
    expect(currencyFactor(usdRates, 'MXN', 'USD', '2026-09-01')).toBeCloseTo(1 / 20, 12)
    expect(currencyFactor(usdRates, 'MXN', 'MXN', '2026-09-01')).toBe(1)
  })

  it('returns null rather than guess when a rate is unknown', () => {
    expect(currencyFactor(usdRates, 'EUR', 'MXN', '2026-09-01')).toBeNull()
    expect(currencyFactor(usdRates, '', 'MXN', '2026-09-01')).toBeNull()
  })
})

describe('bookInBase', () => {
  const conversion = buildConversion({ currencyBySymbol: { AAA: 'USD' }, base: 'MXN', usdRates })
  const cash = (currency: string, date: string) => currencyFactor(usdRates, currency, 'MXN', date)

  // Bought 10 AAA on the 1st at 2,000 MXN each (100 USD at 20); it closes at
  // 100 USD on the 1st and 101 USD on the 2nd.
  const transactions = [{ executed_at: '2026-09-01', type: 'buy' as const, symbol: 'AAA', quantity: 10, price: 2000, currency: 'MXN' }]
  const prices = { AAA: { '2026-09-01': 100, '2026-09-02': 101 } }

  it('puts closes and trade prices in one currency, each at its own date', () => {
    const r = bookInBase(transactions, prices, conversion, cash)
    expect(r.prices.AAA['2026-09-01']).toBe(2000)
    expect(r.prices.AAA['2026-09-02']).toBe(1818)
    expect(r.transactions[0].price).toBe(2000)
    expect(r.unconverted).toEqual([])
  })

  it('makes the returns what the book actually did', () => {
    // In pesos the book went from 20,000 to 18,180: the dollar gain of 1% was
    // eaten by the peso strengthening 10%. Unconverted, the chain compared
    // dollar closes with a peso purchase and collapsed.
    const r = bookInBase(transactions, prices, conversion, cash)
    const book = reconstructBookHistory(r.transactions, r.prices)
    const twr = calculateTWR(book.snapshots, book.flows)!
    expect(twr).toBeCloseTo((18180 / 20000 - 1) * 100, 6)
    expect(calculateSimpleReturn(10 * r.prices.AAA['2026-09-02'], 10 * r.transactions[0].price)).toBeCloseTo(-9.1, 6)
  })

  it('names what it could not convert instead of mixing it in', () => {
    const r = bookInBase(
      [{ ...transactions[0], currency: 'EUR' }],
      prices,
      buildConversion({ currencyBySymbol: {}, base: 'MXN', usdRates }),
      cash,
    )
    expect(r.unconverted).toEqual(['AAA'])
    expect(r.transactions[0].price).toBe(2000)
  })

  it('leaves a split alone: its "price" is not money', () => {
    const split = { executed_at: '2026-09-02', type: 'split' as const, symbol: 'AAA', quantity: 2, price: 0, currency: 'MXN' }
    expect(bookInBase([split], {}, conversion, cash).transactions[0]).toBe(split)
  })
})
