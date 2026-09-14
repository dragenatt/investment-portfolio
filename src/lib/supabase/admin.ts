// The service-role Supabase client — one definition.
//
// It bypasses row-level security, so it exists only on the server and only for
// writes the user's own session must not be able to make: shared market data
// (price_history, current_prices, factor_returns), job state, observability.
// There were four hand-rolled copies of this before; they now all come here.
//
// Returns null when the key is not configured instead of throwing, so callers
// decide whether a missing key is fatal (a cron) or degradable (a cache write).

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let cached: SupabaseClient | null = null

export function serviceRoleClient(): SupabaseClient | null {
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
