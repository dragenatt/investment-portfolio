// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// The policy was enforced in silence: a directive too strict for something
// legitimate looked like a feature that mysteriously stopped working, and an
// attempted injection looked like nothing at all.

const captured = vi.hoisted(() => ({ messages: [] as Array<{ message: string; extra: unknown }> }))

vi.mock('@sentry/nextjs', () => ({
  captureMessage: (message: string, options: { extra?: unknown }) => {
    captured.messages.push({ message, extra: options?.extra })
  },
}))

const { POST } = await import('@/app/api/csp-report/route')

const post = (body: unknown) =>
  POST(new Request('http://test/api/csp-report', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }))

beforeEach(() => {
  captured.messages.length = 0
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('POST /api/csp-report', () => {
  it('reports a violation sent the old way', async () => {
    const response = await post({
      'csp-report': {
        'document-uri': 'https://app.example/dashboard',
        'effective-directive': 'script-src',
        'blocked-uri': 'https://evil.example/x.js',
      },
    })

    expect(response.status).toBe(204)
    expect(captured.messages).toHaveLength(1)
    expect(captured.messages[0].extra).toMatchObject({
      effectiveDirective: 'script-src',
      blockedUri: 'https://evil.example/x.js',
    })
  })

  it('reports a violation sent the new way', async () => {
    await post([
      {
        type: 'csp-violation',
        body: {
          documentURL: 'https://app.example/login',
          effectiveDirective: 'style-src',
          blockedURL: 'https://cdn.example/x.css',
        },
      },
    ])

    expect(captured.messages[0].extra).toMatchObject({ effectiveDirective: 'style-src' })
  })

  it('ignores the browser extensions that trip the policy on every page', async () => {
    await post({
      'csp-report': {
        'effective-directive': 'script-src',
        'blocked-uri': 'chrome-extension://abcdefghijklmnop/inject.js',
      },
    })

    expect(captured.messages).toEqual([])
  })

  it('answers 204 to a malformed body without reporting anything', async () => {
    const response = await post('not json at all')

    expect(response.status).toBe(204)
    expect(captured.messages).toEqual([])
  })

  it('refuses to read an oversized body', async () => {
    const response = await post({ 'csp-report': { 'effective-directive': 'script-src', padding: 'x'.repeat(9_000) } })

    expect(response.status).toBe(204)
    expect(captured.messages).toEqual([])
  })

  it('truncates a field long enough to be a payload', async () => {
    await post({ 'csp-report': { 'effective-directive': 'img-src', 'blocked-uri': `https://x.example/${'a'.repeat(2_000)}` } })

    const extra = captured.messages[0].extra as { blockedUri: string }
    expect(extra.blockedUri.length).toBe(500)
  })
})
