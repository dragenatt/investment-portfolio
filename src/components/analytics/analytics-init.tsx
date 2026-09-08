'use client'

import { useEffect } from 'react'
import { initBrowserAnalytics } from '@/lib/analytics/posthog-browser'

/**
 * Boots posthog-js once per session and ties it to the internal Supabase user
 * id — never to an email or a display name. Renders nothing, and does nothing
 * at all while NEXT_PUBLIC_POSTHOG_KEY is unset.
 */
export function AnalyticsInit({ userId }: { userId: string }) {
  useEffect(() => {
    void initBrowserAnalytics(userId)
  }, [userId])

  return null
}
