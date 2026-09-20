// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { success, error } from '@/lib/api/response'

// Production served API responses with `public, max-age=0, must-revalidate` —
// the platform's default for a dynamic route with no header of its own,
// including on a 401. `public` invites a proxy or a CDN to keep a copy and
// hand it to somebody else.

describe('Cache-Control on API responses', () => {
  it('marks a successful response private and unstorable', () => {
    expect(success({ ok: true }).headers.get('cache-control')).toBe('private, no-store')
  })

  it('marks a 401 the same way', () => {
    expect(error('Unauthorized', 401).headers.get('cache-control')).toBe('private, no-store')
  })

  it('marks a 404 and a 500 the same way', () => {
    expect(error('No encontrado', 404).headers.get('cache-control')).toBe('private, no-store')
    expect(error('boom', 500).headers.get('cache-control')).toBe('private, no-store')
  })

  it('says nothing public even when the body is empty', () => {
    const header = success(null).headers.get('cache-control')
    expect(header).not.toContain('public')
  })
})
