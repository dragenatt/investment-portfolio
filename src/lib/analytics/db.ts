// Service-role Supabase client for the observability tables.
//
// funnel_events and error_events have RLS on with no policy attached, so only
// the service role can touch them. Returns null when the key is missing instead
// of throwing: analytics is best-effort and must never take a request down.

import type { SupabaseClient } from '@supabase/supabase-js'
import { serviceRoleClient } from '@/lib/supabase/admin'

export function analyticsAdminClient(): SupabaseClient | null {
  return serviceRoleClient()
}
