import { describe, it, expect } from 'vitest'
import {
  classifyFreshness,
  freshnessOf,
  freshnessOfQuote,
  FRESHNESS_STATUS_LABELS,
  type FreshnessStatus,
  type PriceTier,
} from '@/lib/services/freshness'

const NOW = new Date('2026-09-08T15:00:00Z')
const ago = (seconds: number) => new Date(NOW.getTime() - seconds * 1000).toISOString()

describe('classifyFreshness', () => {
  it('calls a price fetched seconds ago live', () => {
    const f = classifyFreshness({ fetchedAt: ago(30), provider: 'twelve-data', asOf: NOW })
    expect(f.status).toBe('live')
    expect(f.ageSeconds).toBe(30)
    expect(f.provider).toBe('twelve-data')
  })

  it('calls a price fetched an hour ago delayed', () => {
    expect(classifyFreshness({ fetchedAt: ago(3600), provider: 'yahoo', asOf: NOW }).status).toBe(
      'delayed',
    )
  })

  it('calls a price fetched two days ago cached', () => {
    expect(
      classifyFreshness({ fetchedAt: ago(2 * 86400), provider: 'yahoo', asOf: NOW }).status,
    ).toBe('cached')
  })

  it('calls a missing price unavailable', () => {
    const f = classifyFreshness({ fetchedAt: null, provider: null, asOf: NOW })
    expect(f.status).toBe('unavailable')
    expect(f.ageSeconds).toBeNull()
  })

  it('calls an unparseable timestamp unavailable rather than guessing', () => {
    expect(classifyFreshness({ fetchedAt: 'not-a-date', provider: 'yahoo', asOf: NOW }).status).toBe(
      'unavailable',
    )
  })

  it('never reports a negative age when a clock runs ahead', () => {
    const f = classifyFreshness({
      fetchedAt: new Date(NOW.getTime() + 60_000).toISOString(),
      provider: 'yahoo',
      asOf: NOW,
    })
    expect(f.ageSeconds).toBe(0)
    expect(f.status).toBe('live')
  })

  it('demotes a price served from cache even when it is recent', () => {
    // The tier matters independently of age: a cache hit is not a live quote
    const f = classifyFreshness({ fetchedAt: ago(10), provider: 'redis', tier: 'cache', asOf: NOW })
    expect(f.status).toBe('cached')
  })

  it('explains itself in words a reader can act on', () => {
    for (const seconds of [10, 3600, 200000]) {
      const f = classifyFreshness({ fetchedAt: ago(seconds), provider: 'yahoo', asOf: NOW })
      expect(f.label.length).toBeGreaterThan(5)
    }
    expect(classifyFreshness({ fetchedAt: null, provider: null, asOf: NOW }).label).toMatch(/no/i)
  })

  it('marks anything that is not a live provider read as not current', () => {
    expect(classifyFreshness({ fetchedAt: ago(10), provider: 'yahoo', asOf: NOW }).isCurrent).toBe(true)
    expect(classifyFreshness({ fetchedAt: ago(90000), provider: 'yahoo', asOf: NOW }).isCurrent).toBe(false)
    expect(classifyFreshness({ fetchedAt: null, provider: null, asOf: NOW }).isCurrent).toBe(false)
  })

  it('honours a caller-supplied delay threshold', () => {
    const f = classifyFreshness({
      fetchedAt: ago(120),
      provider: 'yahoo',
      asOf: NOW,
      liveWithinSeconds: 60,
    })
    expect(f.status).toBe('delayed')
  })

  it('is deterministic', () => {
    const args = { fetchedAt: ago(500), provider: 'finnhub', asOf: NOW } as const
    expect(classifyFreshness(args)).toEqual(classifyFreshness(args))
  })
})

describe('wording', () => {
  it('speaks Spanish, because it is rendered as-is', () => {
    expect(classifyFreshness({ fetchedAt: ago(20), asOf: NOW }).label).toBe('Actualizado hace 20 s.')
    expect(classifyFreshness({ fetchedAt: ago(3 * 3600), asOf: NOW }).label).toBe('Con retraso: actualizado hace 3 h.')
    expect(classifyFreshness({ fetchedAt: ago(3 * 86400), asOf: NOW }).label).toBe(
      'Precio guardado hace 3 días. No es el precio actual.',
    )
    expect(classifyFreshness({ fetchedAt: null, asOf: NOW }).label).toMatch(/costo promedio/)
  })

  it('names every state, so a screen can show which of the four it is', () => {
    const states: FreshnessStatus[] = ['live', 'delayed', 'cached', 'unavailable']
    expect(Object.keys(FRESHNESS_STATUS_LABELS).sort()).toEqual([...states].sort())
    expect(new Set(Object.values(FRESHNESS_STATUS_LABELS)).size).toBe(4)
  })
})

describe('freshnessOfQuote', () => {
  it('classifies a batch quote by its own read time', () => {
    expect(freshnessOfQuote({ price: 10, fetchedAt: ago(30) }, { asOf: NOW }).status).toBe('live')
    expect(freshnessOfQuote({ price: 10, fetchedAt: ago(7200) }, { asOf: NOW }).status).toBe('delayed')
    expect(freshnessOfQuote({ price: 10, fetchedAt: ago(200000) }, { asOf: NOW }).status).toBe('cached')
  })

  it('calls a missing quote, or one with no usable price, unavailable', () => {
    expect(freshnessOfQuote(undefined, { asOf: NOW }).status).toBe('unavailable')
    expect(freshnessOfQuote({ price: null, fetchedAt: ago(5) }, { asOf: NOW }).status).toBe('unavailable')
    expect(freshnessOfQuote({ price: 0, fetchedAt: ago(5) }, { asOf: NOW }).status).toBe('unavailable')
  })

  it('never calls a price of unknown age current', () => {
    // The old page flag called any quote that existed current.
    const f = freshnessOfQuote({ price: 10 }, { asOf: NOW })
    expect(f.status).toBe('cached')
    expect(f.isCurrent).toBe(false)
    expect(f.ageSeconds).toBeNull()
  })
})

describe('freshnessOf', () => {
  it('reads the status straight off a stored price row', () => {
    const f = freshnessOf({ fetched_at: ago(45) }, { asOf: NOW, provider: 'db' })
    expect(f.status).toBe('live')
  })

  it('reports unavailable when there is no row at all', () => {
    expect(freshnessOf(undefined, { asOf: NOW }).status).toBe('unavailable')
    expect(freshnessOf(null, { asOf: NOW }).status).toBe('unavailable')
  })

  it('accepts every tier the provider chain can answer from', () => {
    const tiers: PriceTier[] = ['primary', 'secondary', 'cache']
    for (const tier of tiers) {
      const f = classifyFreshness({ fetchedAt: ago(20), provider: 'x', tier, asOf: NOW })
      expect(f.tier).toBe(tier)
    }
  })
})
