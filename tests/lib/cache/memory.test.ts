import { describe, it, expect } from 'vitest'
import { createMemoryCache } from '@/lib/cache/memory'
import { bookFingerprint } from '@/lib/services/portfolio-history'

// Redis is off in production, so every cacheGet/cacheSet is a no-op and the
// dashboard's value chart was rebuilt on every 60-second refresh of every open
// dashboard. It now stays in the instance that computed it, keyed by what it
// was computed from.

describe('createMemoryCache', () => {
  it('returns a value until its time to live runs out, and not after', () => {
    let clock = 1_000
    const cache = createMemoryCache<string>(10, () => clock)

    cache.set('k', 'v', 60_000)
    clock += 59_999
    expect(cache.get('k')).toBe('v')
    clock += 1
    expect(cache.get('k')).toBeUndefined()
  })

  it('does not extend a value\'s life by reading it', () => {
    let clock = 0
    const cache = createMemoryCache<string>(10, () => clock)

    cache.set('k', 'v', 60_000)
    for (let i = 0; i < 5; i++) {
      clock += 30_000
      cache.get('k')
    }
    expect(cache.get('k')).toBeUndefined()
  })

  it('evicts the least recently used entry when full', () => {
    const cache = createMemoryCache<number>(2)
    cache.set('a', 1, 60_000)
    cache.set('b', 2, 60_000)
    cache.get('a')
    cache.set('c', 3, 60_000)

    expect(cache.get('a')).toBe(1)
    expect(cache.get('b')).toBeUndefined()
    expect(cache.get('c')).toBe(3)
    expect(cache.size).toBe(2)
  })
})

describe('bookFingerprint', () => {
  const buy = { executed_at: '2026-09-18', type: 'buy', symbol: 'AAA', quantity: 2, price: 10 }

  it('is the same for the same book', () => {
    expect(bookFingerprint(['p2', 'p1'], [buy])).toBe(bookFingerprint(['p1', 'p2'], [{ ...buy }]))
  })

  it('changes with a trade added, edited or moved to another symbol', () => {
    const base = bookFingerprint(['p1'], [buy])

    expect(bookFingerprint(['p1'], [buy, { ...buy, executed_at: '2026-09-19' }])).not.toBe(base)
    expect(bookFingerprint(['p1'], [{ ...buy, price: 10.5 }])).not.toBe(base)
    expect(bookFingerprint(['p1'], [{ ...buy, quantity: 3 }])).not.toBe(base)
    expect(bookFingerprint(['p1'], [{ ...buy, symbol: 'AAA.MX' }])).not.toBe(base)
  })

  it('changes when a portfolio is added or removed', () => {
    expect(bookFingerprint(['p1', 'p2'], [buy])).not.toBe(bookFingerprint(['p1'], [buy]))
  })
})
