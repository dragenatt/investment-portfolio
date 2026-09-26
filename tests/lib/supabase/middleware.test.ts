import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { AuthApiError } from '@supabase/supabase-js'

// Ten 500s across four users came from one line: getUser() rejects when the
// refresh token in the cookie is spent, and nothing caught it. A session that
// cannot be refreshed is the same situation as no session, and a page must say
// so with a login redirect rather than an error.

const auth = vi.hoisted(() => ({ getUser: vi.fn() }))

vi.mock('@supabase/ssr', () => ({ createServerClient: () => ({ auth }) }))

const { updateSession, sessionFailureResponse } = await import('@/lib/supabase/middleware')

const AUTH_COOKIE = 'sb-abcdefgh-auth-token'

/** How a cookie is removed: an empty value that expired at the epoch. */
const EXPIRED = /Expires=Thu, 01 Jan 1970/i

function request(path: string, cookie = `${AUTH_COOKIE}=stale-refresh-token`) {
  return new NextRequest(`https://app.example/${path.replace(/^\//, '')}`, {
    headers: { cookie },
  })
}

/** The Set-Cookie lines a response carries, as one string. */
function setCookie(response: { headers: Headers }): string {
  return response.headers.getSetCookie().join('\n')
}

beforeEach(() => {
  auth.getUser.mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('updateSession with an unusable session', () => {
  it('redirects a page to login instead of throwing', async () => {
    auth.getUser.mockRejectedValue(new AuthApiError('Invalid Refresh Token', 400, 'refresh_token_not_found'))

    const { response, userId } = await updateSession(request('/lab?e=volatility'))

    expect(response.status).toBe(307)
    // The page they asked for comes back after signing in, query and all.
    expect(response.headers.get('location')).toBe('https://app.example/login?next=%2Flab%3Fe%3Dvolatility')
    expect(userId).toBeNull()
  })

  it('drops the spent cookie so the browser stops presenting it', async () => {
    auth.getUser.mockRejectedValue(new AuthApiError('Invalid Refresh Token', 400, 'refresh_token_not_found'))

    const { response } = await updateSession(request('/dashboard'))

    expect(setCookie(response)).toContain(AUTH_COOKIE)
    expect(setCookie(response)).toMatch(EXPIRED)
  })

  it('clears the chunked cookies too', async () => {
    auth.getUser.mockRejectedValue(new AuthApiError('Invalid Refresh Token', 400, 'refresh_token_not_found'))

    const { response } = await updateSession(
      request('/api/portfolio', `${AUTH_COOKIE}.0=part-one; ${AUTH_COOKIE}.1=part-two`),
    )

    expect(setCookie(response)).toContain(`${AUTH_COOKIE}.0`)
    expect(setCookie(response)).toContain(`${AUTH_COOKIE}.1`)
  })

  it('lets an API route answer for itself rather than redirecting it', async () => {
    auth.getUser.mockRejectedValue(new AuthApiError('Invalid Refresh Token', 400, 'refresh_token_not_found'))

    const { response, userId } = await updateSession(request('/api/portfolio'))

    expect(response.status).toBe(200)
    expect(userId).toBeNull()
  })

  it('still serves the public pages', async () => {
    auth.getUser.mockRejectedValue(new AuthApiError('Invalid Refresh Token', 400, 'refresh_token_not_found'))

    const { response } = await updateSession(request('/'))

    expect(response.status).toBe(200)
  })
})

describe('updateSession when two requests refresh the same session at once', () => {
  // Refresh tokens rotate. A dashboard opens several requests at once, one of
  // them refreshes the token, and the others arrive holding the copy it
  // replaced. Supabase answers 'conflict' or 'refresh_token_already_used' —
  // 44 times in production — and clearing the cookie over it deleted the one
  // the winning request had just set, ending a session that was alive.
  for (const [code, status] of [['conflict', 409], ['refresh_token_already_used', 400]] as const) {
    it(`keeps the cookie when the answer is ${code}`, async () => {
      auth.getUser.mockRejectedValue(new AuthApiError('Race', status, code))

      const { response, userId } = await updateSession(request('/dashboard'))

      // This request has no user of its own, so the page still goes to login…
      expect(response.status).toBe(307)
      expect(userId).toBeNull()
      // …but nothing is signed out: the next request carries the cookie that won.
      expect(setCookie(response)).not.toMatch(EXPIRED)
    })
  }

  it('leaves an API request to answer for itself with the session intact', async () => {
    auth.getUser.mockRejectedValue(new AuthApiError('Race', 409, 'conflict'))

    const { response } = await updateSession(request('/api/portfolio'))

    expect(response.status).toBe(200)
    expect(setCookie(response)).not.toMatch(EXPIRED)
  })

  it('still drops the cookie for a session that cannot come back', async () => {
    for (const code of ['session_not_found', 'user_not_found', 'session_expired', 'bad_jwt']) {
      auth.getUser.mockRejectedValue(new AuthApiError('Gone', 400, code))

      const { response } = await updateSession(request('/dashboard'))

      expect(setCookie(response), code).toMatch(EXPIRED)
    }
  })
})

describe('updateSession when Supabase cannot be reached', () => {
  it('signs the request out for now but keeps the cookie', async () => {
    auth.getUser.mockRejectedValue(new TypeError('fetch failed'))

    const { response } = await updateSession(request('/dashboard'))

    // A bad minute of connectivity is not evidence that the session is spent.
    expect(response.status).toBe(307)
    expect(setCookie(response)).not.toMatch(EXPIRED)
  })
})

describe('updateSession with a live session', () => {
  it('passes the user id back and touches no cookie', async () => {
    auth.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })

    const { response, userId } = await updateSession(request('/dashboard'))

    expect(userId).toBe('user-1')
    expect(response.status).toBe(200)
    expect(setCookie(response)).toBe('')
  })
})

describe('sessionFailureResponse', () => {
  it('sends a private page to login', () => {
    expect(sessionFailureResponse(request('/portfolio/123')).headers.get('location')).toBe(
      'https://app.example/login?next=%2Fportfolio%2F123',
    )
  })

  it('lets a public page and an API route through', () => {
    expect(sessionFailureResponse(request('/login')).status).toBe(200)
    expect(sessionFailureResponse(request('/api/health')).status).toBe(200)
  })
})

describe('a path that is not a page', () => {
  // /lo-que-sea went to /login?next=%2Flo-que-sea: a visitor was asked to sign
  // in for something that would not be there afterwards, and not-found.tsx —
  // which has existed all along — was unreachable without a session.
  beforeEach(() => {
    auth.getUser.mockResolvedValue({ data: { user: null } })
  })

  it('continues to Next, which renders the 404', async () => {
    const { response } = await updateSession(request('/lo-que-sea', ''))

    expect(response.status).toBe(200)
    expect(response.headers.get('location')).toBeNull()
  })

  it('still sends a real page to login, remembering where it was going', async () => {
    const { response } = await updateSession(request('/portfolio/abc', ''))

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('https://app.example/login?next=%2Fportfolio%2Fabc')
  })

  it('treats a deeper path by its section', async () => {
    const known = await updateSession(request('/settings/privacy', ''))
    const unknown = await updateSession(request('/settings-de-mentira/privacy', ''))

    expect(known.response.status).toBe(307)
    expect(unknown.response.status).toBe(200)
  })
})

describe('the pages for someone who cannot sign in', () => {
  it('lets the recovery pages and the email-link route through without a session', async () => {
    auth.getUser.mockResolvedValue({ data: { user: null } })

    for (const path of ['/forgot-password', '/reset-password', '/auth/callback?code=abc']) {
      const { response } = await updateSession(request(path, ''))
      expect(response.headers.get('location'), path).toBeNull()
    }
  })

  it('hands a code that landed on the Site URL to the route that exchanges it', async () => {
    // Supabase falls back to the Site URL when a link's redirect is not
    // allow-listed, and "/" has nothing that would exchange the code.
    const { response } = await updateSession(request('/?code=one-time', ''))

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('https://app.example/auth/callback?code=one-time')
    expect(auth.getUser).not.toHaveBeenCalled()
  })
})
