'use client'

import { useEffect } from 'react'

// Registers public/sw.js (C4), or removes it.
//
// The script URL carries the build version, so every deploy installs a fresh
// worker that discards the previous build's saved pages and files. Only
// production builds register: in development, cache-first on /_next/static
// would fight hot reloading.
//
// `enabled` comes from the `pwa` feature flag on the server. Turning the flag
// off is a kill switch: pages unregister the worker and delete its caches, so a
// broken worker can be withdrawn with an environment variable and a redeploy.

const BUILD_VERSION = process.env.NEXT_PUBLIC_BUILD_VERSION ?? 'dev'

async function unregisterAll() {
  const registrations = await navigator.serviceWorker.getRegistrations()
  await Promise.all(registrations.map((registration) => registration.unregister()))
  if (typeof caches !== 'undefined') {
    const keys = await caches.keys()
    await Promise.all(keys.filter((key) => key.startsWith('it-')).map((key) => caches.delete(key)))
  }
}

/**
 * A page served from the saved copy asks the worker how refreshing that copy
 * went. 'redirect' means the session behind it has ended: reload, and the
 * server's redirect to /login takes over instead of a signed-in shell.
 */
function checkShellFreshness() {
  const controller = navigator.serviceWorker.controller
  if (!controller) return () => {}
  const url = window.location.href
  const onMessage = (event: MessageEvent) => {
    const data = event.data as { type?: string; url?: string; status?: string } | null
    if (data?.type !== 'shell-status' || data.url !== url) return
    navigator.serviceWorker.removeEventListener('message', onMessage)
    if (data.status === 'redirect') window.location.reload()
  }
  navigator.serviceWorker.addEventListener('message', onMessage)
  controller.postMessage({ type: 'shell-status', url })
  return () => navigator.serviceWorker.removeEventListener('message', onMessage)
}

export function ServiceWorkerRegistration({ enabled }: { enabled: boolean }) {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return
    if (!('serviceWorker' in navigator)) return

    if (!enabled) {
      unregisterAll().catch(() => {})
      return
    }

    const stopChecking = checkShellFreshness()
    navigator.serviceWorker
      .register(`/sw.js?v=${encodeURIComponent(BUILD_VERSION)}`, { scope: '/', updateViaCache: 'none' })
      .catch(() => {
        // Registration fails in private windows and on http origins. The app
        // works exactly as it did without a worker.
      })
    return stopChecking
  }, [enabled])

  return null
}
