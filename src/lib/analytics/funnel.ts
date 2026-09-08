// The single entry point for recording a funnel step.
//
// Writes to our own funnel_events table (what /admin/metrics reads) and forwards
// the same event to PostHog. Both sides are best-effort: recording a funnel step
// must never fail the request that triggered it.

import { analyticsAdminClient } from './db'
import { captureServer } from './posthog'
import { ONCE_PER_USER_EVENTS, type EventProperties, type FunnelEvent } from './events'

/** Postgres unique_violation — the once-per-user index already holds this step. */
const UNIQUE_VIOLATION = '23505'

/**
 * Record one funnel step for a user.
 *
 * `userId` must be the internal Supabase user id taken from the session, never
 * anything the client supplied, and `properties` must stay free of personal data.
 *
 * For the once-per-user steps the partial unique index from migration 012 does
 * the deduplication, so two concurrent requests cannot both count as "first".
 * A duplicate is silently dropped and is not forwarded to PostHog either.
 */
export async function recordFunnelEvent(
  event: FunnelEvent,
  userId: string,
  properties: EventProperties = {}
): Promise<void> {
  const supabase = analyticsAdminClient()

  if (supabase) {
    try {
      const { error } = await supabase
        .from('funnel_events')
        .insert({ user_id: userId, event, properties })

      if (error) {
        if (error.code === UNIQUE_VIOLATION && ONCE_PER_USER_EVENTS.includes(event)) {
          return // already counted; not a first time any more
        }
        console.error('[funnel] insert failed', error.message)
      }
    } catch (err) {
      console.error('[funnel] insert threw', err)
    }
  }

  await captureServer(event, userId, properties)
}
