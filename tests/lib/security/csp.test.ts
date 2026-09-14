// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { buildContentSecurityPolicy, createNonce } from '@/lib/security/csp'

function directives(csp: string): Record<string, string[]> {
  return Object.fromEntries(
    csp.split(';').map((part) => {
      const [name, ...values] = part.trim().split(/\s+/)
      return [name, values]
    }),
  )
}

const base = { nonce: 'abc123', isDev: false, supabaseUrl: 'https://mabmqxztvakaijtrncyl.supabase.co' }

describe('buildContentSecurityPolicy', () => {
  it('allows scripts only through the nonce and what they load', () => {
    const d = directives(buildContentSecurityPolicy(base))
    expect(d['script-src']).toEqual(["'self'", "'nonce-abc123'", "'strict-dynamic'"])
    expect(d['script-src']).not.toContain("'unsafe-inline'")
    expect(d['script-src']).not.toContain("'unsafe-eval'")
  })

  it('adds unsafe-eval in development only', () => {
    expect(directives(buildContentSecurityPolicy({ ...base, isDev: true }))['script-src']).toContain("'unsafe-eval'")
  })

  it('lets the browser reach Supabase over https and the Realtime websocket', () => {
    const connect = directives(buildContentSecurityPolicy(base))['connect-src']
    expect(connect).toContain('https://mabmqxztvakaijtrncyl.supabase.co')
    expect(connect).toContain('wss://mabmqxztvakaijtrncyl.supabase.co')
  })

  it('refuses framing by other sites, plugins and base-tag hijacking', () => {
    const d = directives(buildContentSecurityPolicy(base))
    expect(d['frame-ancestors']).toEqual(["'self'"])
    expect(d['object-src']).toEqual(["'none'"])
    expect(d['base-uri']).toEqual(["'self'"])
    expect(d['form-action']).toEqual(["'self'"])
  })

  it('ignores a malformed URL instead of writing it into the policy', () => {
    const csp = buildContentSecurityPolicy({ ...base, supabaseUrl: 'not a url; script-src *' })
    expect(csp).not.toContain('not a url')
    expect(directives(csp)['script-src']).not.toContain('*')
  })

  it('includes PostHog only when configured', () => {
    expect(buildContentSecurityPolicy(base)).not.toContain('posthog')
    expect(directives(buildContentSecurityPolicy({ ...base, posthogHost: 'https://us.i.posthog.com' }))['connect-src']).toContain(
      'https://us.i.posthog.com',
    )
  })
})

describe('createNonce', () => {
  it('is different every time and safe inside a header', () => {
    const a = createNonce()
    const b = createNonce()
    expect(a).not.toBe(b)
    expect(a).toMatch(/^[A-Za-z0-9+/=]{24,}$/)
  })
})
