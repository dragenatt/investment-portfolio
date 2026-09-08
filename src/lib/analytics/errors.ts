// Local error log — the "recent errors" half of /admin/metrics.
//
// Sentry is the real error tracker; this table exists so the dashboard can show
// something without a Sentry API token, and so the team keeps a record even if
// the Sentry free-plan quota runs out for the month.

import { analyticsAdminClient } from './db'

/** Long stack-ish messages are truncated: the tile only needs the gist. */
const MAX_MESSAGE = 500

/**
 * Fire-and-forget: never awaited by the request path, never throws.
 * `route` must be a pathname only — query strings carry ids and user input.
 */
export function recordApiError(route: string, method: string, message: string): void {
  const supabase = analyticsAdminClient()
  if (!supabase) return

  void supabase
    .from('error_events')
    .insert({ route, method, message: message.slice(0, MAX_MESSAGE) })
    .then(({ error }) => {
      if (error) console.error('[error-log] insert failed', error.message)
    })
}
