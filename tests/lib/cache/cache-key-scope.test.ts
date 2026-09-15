// @vitest-environment node
//
// Cache keys must carry the caller when the cached value depends on who asks.
//
// The analytics routes compute with the signed-in user's Supabase client, so
// row-level security decides what goes into the result. Their cache keys used
// to be the portfolio id alone: with Upstash configured — which the security
// audit recommends — the first person to open a portfolio's analytics would
// have filled the cache, and anyone requesting that portfolio id afterwards
// would have been served the result without RLS ever running for them. Caching
// is off today (no Upstash variables), so nothing leaked; this keeps it that
// way when caching is turned on.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const API_DIR = path.resolve(__dirname, '../../../src/app/api')

/** Keys for data that is the same for every caller: market data and public listings. */
const PUBLIC_KEY_PREFIXES = [
  'market:',
  '${CACHE_KEYS.MARKET_EVENTS}',
  '${CACHE_KEYS.MARKET_HISTORY}',
  '${CACHE_KEYS.MARKET_FUNDAMENTALS}',
  '${CACHE_KEYS.PRICE}',
  'discover:',
  '${CACHE_KEYS.PORTFOLIO_COMPARISON}public:',
]

function routeFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return routeFiles(full)
    return entry.name === 'route.ts' ? [full] : []
  })
}

/** The first argument of every withCache / cacheGet / cacheSet call, resolved through a local `cacheKey` const. */
function cacheKeys(source: string): string[] {
  const keys: string[] = []
  // Any cache wrapper, with or without a type argument: `withCache<Inputs>(` slipped past
  // a pattern that only knew `withCache(`, and a per-user key without the user with it.
  const calls = /\b(?:withCache\w*|cacheGet|cacheSet)(?:<[^>]*>)?\(\s*([^,]+),/g
  for (const match of source.matchAll(calls)) {
    // Drop comments written inside the call, before the key.
    let arg = match[1].replace(/\/\/[^\n]*\n/g, '').trim()
    if (/^[A-Za-z_]\w*$/.test(arg)) {
      const declaration = source.match(new RegExp(`const ${arg}\\s*=\\s*(\`[^\`]*\`|'[^']*')`))
      if (declaration) arg = declaration[1]
    }
    keys.push(arg)
  }
  return keys
}

describe('cache keys for per-user data', () => {
  const files = routeFiles(API_DIR)

  it('finds the cached routes (the scan itself works)', () => {
    const cached = files.filter((file) => cacheKeys(fs.readFileSync(file, 'utf8')).length > 0)
    expect(cached.length).toBeGreaterThan(15)
  })

  it('include the user id unless the data is public', () => {
    const offenders: string[] = []
    for (const file of files) {
      for (const key of cacheKeys(fs.readFileSync(file, 'utf8'))) {
        const literal = key.replace(/^[`']/, '')
        if (PUBLIC_KEY_PREFIXES.some((prefix) => literal.startsWith(prefix))) continue
        if (!key.includes('user.id')) offenders.push(`${path.relative(API_DIR, file)}: ${key}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
