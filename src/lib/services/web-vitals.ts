// Field Core Web Vitals (C3) — validation for what browsers report. No I/O.
//
// Lab measurements (scripts/web-vitals-lab.mjs) can only reach the public pages:
// the signed-in pages need a session the lab has no business holding. Real
// users' browsers measure every page, so the app reports LCP, CLS and INP (and
// FCP, TTFB) from them into a web_vitals table. Nothing identifies the user; a
// route pattern and a number are all that is kept.
//
// The endpoint that receives these is open to signed-out pages too, so
// everything here assumes the body is hostile: known metric names only, values
// inside what the metric can physically be, and routes reduced to a pattern
// before storage so no id, symbol or query string is kept.

export const VITAL_NAMES = ['LCP', 'CLS', 'INP', 'FCP', 'TTFB'] as const
export type VitalName = (typeof VITAL_NAMES)[number]

const RATINGS = ['good', 'needs-improvement', 'poor'] as const
const NAVIGATION_TYPES = ['navigate', 'reload', 'back-forward', 'back-forward-cache', 'prerender', 'restore'] as const

/** Upper bounds past which a value is corrupt rather than slow. */
const MAX_VALUE: Record<VitalName, number> = {
  LCP: 3_600_000,
  INP: 3_600_000,
  FCP: 3_600_000,
  TTFB: 3_600_000,
  CLS: 10,
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_ROUTE_LENGTH = 200

/** The route pattern for a pathname: ids, symbols and usernames collapsed. */
export function normaliseRoute(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_ROUTE_LENGTH) return null
  if (!raw.startsWith('/') || raw.startsWith('//')) return null
  const path = raw.split(/[?#]/)[0]
  const segments = path.split('/').filter(Boolean)
  const out = segments.map((segment, i) => {
    if (UUID.test(segment)) return '[id]'
    const previous = segments[i - 1]
    if (previous === 'market' && segment !== 'compare') return '[symbol]'
    if (previous === 'profile') return '[username]'
    return segment
  })
  const route = '/' + out.join('/')
  return /^[\w\-/[\]]*$/.test(route) ? route : null
}

export type VitalRow = {
  name: VitalName
  value: number
  rating: (typeof RATINGS)[number] | null
  navigation_type: (typeof NAVIGATION_TYPES)[number] | null
  route: string
}

export function parseVital(body: unknown): VitalRow | null {
  if (!body || typeof body !== 'object') return null
  const input = body as Record<string, unknown>

  const name = input.name
  if (typeof name !== 'string' || !(VITAL_NAMES as readonly string[]).includes(name)) return null

  const value = input.value
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null
  if (value > MAX_VALUE[name as VitalName]) return null

  const route = normaliseRoute(input.route)
  if (!route) return null

  const rating = (RATINGS as readonly string[]).includes(input.rating as string)
    ? (input.rating as VitalRow['rating'])
    : null
  const navigationType = (NAVIGATION_TYPES as readonly string[]).includes(input.navigationType as string)
    ? (input.navigationType as VitalRow['navigation_type'])
    : null

  return { name: name as VitalName, value, rating, navigation_type: navigationType, route }
}
