import { describe, it, expect, vi, beforeEach } from 'vitest'

// There was no way back into an account whose password was forgotten: nothing
// exchanged the one-time code a recovery email carries. This route does, and
// sends each kind of link where it belongs.

const auth = vi.hoisted(() => ({ exchangeCodeForSession: vi.fn(), verifyOtp: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: async () => ({ auth }) }))

const { GET } = await import('@/app/auth/callback/route')

const call = (query: string) => GET(new Request(`https://app.example/auth/callback${query}`))
const location = (response: Response) => response.headers.get('location')

beforeEach(() => {
  auth.exchangeCodeForSession.mockReset()
  auth.verifyOtp.mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('/auth/callback', () => {
  it('sends a recovery link to the page that sets the password', async () => {
    auth.exchangeCodeForSession.mockResolvedValue({ data: { session: {}, redirectType: 'PASSWORD_RECOVERY' }, error: null })

    expect(location(await call('?code=abc&next=/reset-password'))).toBe('https://app.example/reset-password')
  })

  it('knows a recovery link even when its destination was lost on the way', async () => {
    auth.exchangeCodeForSession.mockResolvedValue({ data: { session: {}, redirectType: 'PASSWORD_RECOVERY' }, error: null })

    expect(location(await call('?code=abc'))).toBe('https://app.example/reset-password')
  })

  it('signs a confirmed account in and continues where the link said', async () => {
    auth.exchangeCodeForSession.mockResolvedValue({ data: { session: {}, redirectType: null }, error: null })

    expect(location(await call('?code=abc&next=/settings'))).toBe('https://app.example/settings')
  })

  it('never continues off this origin', async () => {
    auth.exchangeCodeForSession.mockResolvedValue({ data: { session: {}, redirectType: null }, error: null })

    expect(location(await call('?code=abc&next=//evil.example'))).toBe('https://app.example/dashboard')
  })

  it('accepts the token_hash format of the recommended email templates', async () => {
    auth.verifyOtp.mockResolvedValue({ data: {}, error: null })

    expect(location(await call('?token_hash=h&type=recovery'))).toBe('https://app.example/reset-password')
    expect(auth.verifyOtp).toHaveBeenCalledWith({ type: 'recovery', token_hash: 'h' })
  })

  it('sends an expired, used or foreign-browser link to login with a message', async () => {
    auth.exchangeCodeForSession.mockResolvedValue({ data: { session: null }, error: new Error('code verifier not found') })

    expect(location(await call('?code=abc&next=/reset-password'))).toBe('https://app.example/login?error=link')
  })

  it('does the same for a link with nothing in it', async () => {
    expect(location(await call(''))).toBe('https://app.example/login?error=link')
    expect(location(await call('?token_hash=h&type=not-a-type'))).toBe('https://app.example/login?error=link')
  })
})
