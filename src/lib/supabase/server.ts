import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { supabasePublicEnv } from './env'

export async function createServerSupabase() {
  const cookieStore = await cookies()
  const { url, anonKey } = supabasePublicEnv()

  return createServerClient(
    url,
    anonKey,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Called from Server Component — ignore
          }
        },
      },
    }
  )
}
