// Service-role Supabase client for the observability tables.
//
// funnel_events and error_events have RLS on with no policy attached, so only
// the service role can touch them. Returns null when the key is missing instead
// of throwing: analytics is best-effort and must never take a request down.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let cached: SupabaseClient | null = null

export function analyticsAdminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) return null

  if (!cached) {
    cached = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  }
  return cached
}
