import { describe, it, expect, afterEach, vi } from 'vitest'

// Live prices never streamed in production. Vercel stored the anon key with a
// line break at the end. Request headers are trimmed on the way out, so REST and
// auth never noticed; the Realtime socket carries the key in its URL instead,
// where it went out as `…%0A`, and the gateway refused every socket with 401
// "Invalid API key". This builds the real client — @supabase/ssr, supabase-js,
// realtime-js — from values stored that way and reads the URL it would dial.

// Shaped like an anon key; signs nothing.
const KEY = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.dGVzdC1zaWduYXR1cmU'

afterEach(() => vi.unstubAllEnvs())

describe('the browser Supabase client', () => {
  it('dials Realtime with the key and nothing after it', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://abcdefghijklmnop.supabase.co\n')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', `${KEY}\n`)
    const { createClient } = await import('@/lib/supabase/client')

    const socket = new URL(createClient().realtime.endpointURL())

    expect(socket.host).toBe('abcdefghijklmnop.supabase.co')
    expect(socket.searchParams.get('apikey')).toBe(KEY)
  })
})
