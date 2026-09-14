'use client'

import { useSyncExternalStore } from 'react'
import { CloudOff } from 'lucide-react'
import {
  describeOfflineStatus,
  getOfflineStatus,
  getServerOfflineStatus,
  subscribeOfflineStatus,
} from '@/lib/pwa/offline-data'

/**
 * Says so whenever a number on screen is not live (C4): the service worker
 * answered from its saved copy, or the device is offline.
 */
export function OfflineBanner() {
  const status = useSyncExternalStore(subscribeOfflineStatus, getOfflineStatus, getServerOfflineStatus)
  const message = describeOfflineStatus(status)

  return (
    <div role="status" aria-live="polite">
      {message && (
        <div className="flex items-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-900 dark:text-amber-200 lg:px-6">
          <CloudOff className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{message}</span>
        </div>
      )}
    </div>
  )
}
