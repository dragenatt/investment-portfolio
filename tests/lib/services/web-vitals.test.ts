import { describe, it, expect } from 'vitest'
import { normaliseRoute, parseVital, VITAL_NAMES } from '@/lib/services/web-vitals'

describe('normaliseRoute', () => {
  it('collapses ids so every portfolio counts as one route', () => {
    expect(normaliseRoute('/portfolio/ae9f2d48-bdc4-4102-9133-889574494e6b/analytics')).toBe('/portfolio/[id]/analytics')
    expect(normaliseRoute('/portfolio/ae9f2d48-bdc4-4102-9133-889574494e6b')).toBe('/portfolio/[id]')
  })

  it('collapses the symbol and username segments', () => {
    expect(normaliseRoute('/market/AAPL')).toBe('/market/[symbol]')
    expect(normaliseRoute('/market/compare')).toBe('/market/compare')
    expect(normaliseRoute('/profile/angello')).toBe('/profile/[username]')
  })

  it('drops the query string and hash, which can carry anything', () => {
    expect(normaliseRoute('/lab?e=volatility#chart')).toBe('/lab')
  })

  it('keeps plain routes as they are', () => {
    expect(normaliseRoute('/')).toBe('/')
    expect(normaliseRoute('/dashboard')).toBe('/dashboard')
  })

  it('refuses anything that is not a short path', () => {
    expect(normaliseRoute('https://evil.test/x')).toBeNull()
    expect(normaliseRoute('/' + 'a'.repeat(300))).toBeNull()
    expect(normaliseRoute('')).toBeNull()
  })
})

describe('parseVital', () => {
  const good = { name: 'LCP', value: 1234.5, rating: 'good', navigationType: 'navigate', route: '/dashboard' }

  it('accepts a well-formed metric', () => {
    expect(parseVital(good)).toEqual({ name: 'LCP', value: 1234.5, rating: 'good', navigation_type: 'navigate', route: '/dashboard' })
  })

  it('knows the Core Web Vitals and the two supporting ones', () => {
    expect([...VITAL_NAMES].sort()).toEqual(['CLS', 'FCP', 'INP', 'LCP', 'TTFB'])
  })

  it('rejects unknown metric names', () => {
    expect(parseVital({ ...good, name: 'FID' })).toBeNull()
  })

  it('rejects impossible values rather than storing them', () => {
    expect(parseVital({ ...good, value: -1 })).toBeNull()
    expect(parseVital({ ...good, value: Number.NaN })).toBeNull()
    expect(parseVital({ ...good, value: '100' })).toBeNull()
    // An hour-long LCP is not a measurement.
    expect(parseVital({ ...good, value: 3_600_001 })).toBeNull()
    // CLS is unitless and in practice far below 10.
    expect(parseVital({ ...good, name: 'CLS', value: 11 })).toBeNull()
  })

  it('normalises the route and drops an unusable one', () => {
    expect(parseVital({ ...good, route: '/market/MSFT' })!.route).toBe('/market/[symbol]')
    expect(parseVital({ ...good, route: 'javascript:alert(1)' })).toBeNull()
  })

  it('stores an unknown rating or navigation type as null', () => {
    const parsed = parseVital({ ...good, rating: 'amazing', navigationType: 'teleport' })!
    expect(parsed.rating).toBeNull()
    expect(parsed.navigation_type).toBeNull()
  })

  it('rejects a body that is not an object', () => {
    expect(parseVital(null)).toBeNull()
    expect(parseVital('LCP')).toBeNull()
  })
})
