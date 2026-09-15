// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { checkAddress, checkIdentity, clientAddress, FixedWindowCounter, REQUEST_LIMITS } from '@/lib/api/request-limits'

const T0 = 1_000_000

function burst(n: number, fn: (i: number) => { allowed: boolean }) {
  let allowed = 0
  for (let i = 0; i < n; i++) if (fn(i).allowed) allowed++
  return allowed
}

describe('FixedWindowCounter', () => {
  it('allows up to the limit in a window, then refuses', () => {
    const counter = new FixedWindowCounter(60_000)
    expect(burst(10, () => counter.hit('k', 7, T0))).toBe(7)
  })

  it('starts a fresh window once the old one ends', () => {
    const counter = new FixedWindowCounter(60_000)
    burst(7, () => counter.hit('k', 7, T0))
    expect(counter.hit('k', 7, T0 + 59_999).allowed).toBe(false)
    expect(counter.hit('k', 7, T0 + 60_000).allowed).toBe(true)
  })

  it('counts keys independently and prunes finished windows', () => {
    const counter = new FixedWindowCounter(60_000)
    counter.hit('a', 1, T0)
    expect(counter.hit('b', 1, T0).allowed).toBe(true)
    counter.prune(T0 + 60_000)
    expect(counter.size).toBe(0)
  })
})

describe('API request limits', () => {
  it('lets a signed-in user browse far past the old 60/min', () => {
    // The load test: dashboard 6 + portfolio 7 + analytics 14 calls, then tabs.
    const counter = new FixedWindowCounter()
    const allowed = burst(150, () => {
      const address = checkAddress(counter, '198.51.100.7', T0)
      return address.allowed ? checkIdentity(counter, { userId: 'u1', address: '198.51.100.7' }, T0) : address
    })
    expect(allowed).toBe(150)
  })

  it('stops one user at the per-user limit, with Retry-After until the window ends', () => {
    const counter = new FixedWindowCounter()
    burst(REQUEST_LIMITS.perUser, () => checkIdentity(counter, { userId: 'u1', address: 'a' }, T0))
    const refused = checkIdentity(counter, { userId: 'u1', address: 'a' }, T0 + 15_000)
    expect(refused).toEqual({ allowed: false, retryAfterSeconds: 45, scope: 'user' })
  })

  it('gives each person behind one NAT their own budget', () => {
    const counter = new FixedWindowCounter()
    const nat = '203.0.113.1'
    for (const user of ['alice', 'bob', 'carol']) {
      expect(burst(200, () => checkIdentity(counter, { userId: user, address: nat }, T0))).toBe(200)
    }
  })

  it('keeps the strict 60/min for requests without a session', () => {
    const counter = new FixedWindowCounter()
    const result = burst(80, () => checkIdentity(counter, { userId: null, address: '192.0.2.9' }, T0))
    expect(result).toBe(REQUEST_LIMITS.perAnonymousAddress)
  })

  it('caps any single address, signed in or not', () => {
    const counter = new FixedWindowCounter()
    const allowed = burst(REQUEST_LIMITS.perAddress + 50, () => checkAddress(counter, '192.0.2.10', T0))
    expect(allowed).toBe(REQUEST_LIMITS.perAddress)
    expect(checkAddress(counter, '192.0.2.10', T0)).toMatchObject({ allowed: false, scope: 'address' })
  })

  it('does not let a signed-in user refill an anonymous budget or the reverse', () => {
    const counter = new FixedWindowCounter()
    burst(60, () => checkIdentity(counter, { userId: null, address: 'x' }, T0))
    expect(checkIdentity(counter, { userId: null, address: 'x' }, T0).allowed).toBe(false)
    expect(checkIdentity(counter, { userId: 'u9', address: 'x' }, T0).allowed).toBe(true)
  })
})

describe('clientAddress', () => {
  const headers = (entries: Record<string, string>) => new Headers(entries)

  it('takes the first x-forwarded-for entry, then x-real-ip', () => {
    expect(clientAddress(headers({ 'x-forwarded-for': '198.51.100.1, 10.0.0.1' }))).toBe('198.51.100.1')
    expect(clientAddress(headers({ 'x-real-ip': '198.51.100.2' }))).toBe('198.51.100.2')
  })

  it('falls back to one shared bucket when the platform reports nothing', () => {
    expect(clientAddress(headers({}))).toBe('unknown')
    expect(clientAddress(headers({ 'x-forwarded-for': '' }))).toBe('unknown')
  })
})
