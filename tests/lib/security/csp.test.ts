// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
  buildContentSecurityPolicy,
  createNonce,
  reportingEndpointsHeader,
  CSP_REPORT_GROUP,
  CSP_REPORT_PATH,
} from '@/lib/security/csp'

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

describe('violation reporting', () => {
  // Without this the policy is enforced in silence: a directive too strict for
  // something legitimate looks like a feature that stopped working for some
  // people, and an attempted injection looks like nothing at all.
  it('names a group and an endpoint', () => {
    const policy = directives(buildContentSecurityPolicy(base))

    expect(policy['report-to']).toEqual([CSP_REPORT_GROUP])
    expect(policy['report-uri']).toEqual([CSP_REPORT_PATH])
  })

  it('the header the proxy sets names the same group', () => {
    // If the two ever disagree the browser silently drops every report.
    expect(reportingEndpointsHeader()).toBe(`${CSP_REPORT_GROUP}="${CSP_REPORT_PATH}"`)
    expect(directives(buildContentSecurityPolicy(base))['report-to']).toEqual([CSP_REPORT_GROUP])
  })
})
