// PostHog wrapper — server side.
//
// posthog-node only: importing this module from a client component would drag
// the Node SDK (and node:fs) into the browser bundle, which Turbopack refuses to
// chunk. The browser half lives in ./posthog-browser, and the shared vocabulary
// in ./events, so neither runtime pulls in the other's SDK.
//
// Everything here is a no-op while NEXT_PUBLIC_POSTHOG_KEY is unset, so local
// dev and any deploy without the key behave exactly as they did before.
//
// PII policy: the only identifier that ever leaves this app is the internal
// Supabase user id. No emails, display names, portfolio names or amounts.

import { PostHog } from 'posthog-node'
import type { EventProperties, FunnelEvent } from './events'

const key = process.env.NEXT_PUBLIC_POSTHOG_KEY
const host = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com'

export const analyticsEnabled = Boolean(key)

let client: PostHog | null = null

function getClient(): PostHog | null {
  if (!key) return null
  if (!client) {
    // flushAt 1 / flushInterval 0: a serverless invocation dies before a timer
    // would fire, so events go out with the request that produced them.
    client = new PostHog(key, { host, flushAt: 1, flushInterval: 0 })
  }
  return client
}

/**
 * Server-side capture. Never throws and never rejects: analytics must not be
 * able to fail a request.
 */
export async function captureServer(
  event: FunnelEvent,
  userId: string,
  properties: EventProperties = {}
): Promise<void> {
  try {
    const posthog = getClient()
    if (!posthog) return
    posthog.capture({ distinctId: userId, event, properties })
    await posthog.flush()
  } catch {
    // best-effort
  }
}
