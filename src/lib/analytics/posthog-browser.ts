// PostHog wrapper — browser side.
//
// posthog-js only, kept apart from ./posthog so the Node SDK never reaches the
// client bundle. Import is dynamic so the library is only fetched when a key is
// actually configured.
//
// autocapture and session recording are off on purpose: both would sweep up
// whatever the user typed, and the only identifier this project sends is the
// internal Supabase user id.

import type { EventProperties, FunnelEvent } from './events'

const key = process.env.NEXT_PUBLIC_POSTHOG_KEY
const host = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com'

/** Boots posthog-js once. Safe to call repeatedly. */
export async function initBrowserAnalytics(userId?: string): Promise<void> {
  if (!key || typeof window === 'undefined') return
  try {
    const { default: posthog } = await import('posthog-js')
    if (!posthog.__loaded) {
      posthog.init(key, {
        api_host: host,
        person_profiles: 'identified_only',
        autocapture: false,
        disable_session_recording: true,
      })
    }
    if (userId) posthog.identify(userId)
  } catch {
    // best-effort
  }
}

/** Browser-side capture of a funnel event. */
export async function captureBrowser(
  event: FunnelEvent,
  properties: EventProperties = {}
): Promise<void> {
  if (!key || typeof window === 'undefined') return
  try {
    const { default: posthog } = await import('posthog-js')
    posthog.capture(event, properties)
  } catch {
    // best-effort
  }
}
