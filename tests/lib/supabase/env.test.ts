import { describe, it, expect, afterEach, vi } from 'vitest'
import { supabasePublicEnv } from '@/lib/supabase/env'

// Vercel held NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY with a
// line break at the end, and Next inlines a public value into the bundle exactly
// as it is stored. Every client that uses the anon key reads both through here.

const PROJECT_URL = 'https://abcdefghijklmnop.supabase.co'
// Shaped like an anon key; signs nothing.
const KEY = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.dGVzdC1zaWduYXR1cmU'

afterEach(() => vi.unstubAllEnvs())

describe('supabasePublicEnv', () => {
  it('drops the line break a stored value carries at either end', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', `${PROJECT_URL}\n`)
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', ` ${KEY}\r\n`)

    expect(supabasePublicEnv()).toEqual({ url: PROJECT_URL, anonKey: KEY })
  })

  it('leaves a missing value empty, for the client to refuse by name', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', undefined)
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', undefined)

    expect(supabasePublicEnv()).toEqual({ url: '', anonKey: '' })
  })
})
