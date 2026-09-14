// What the page knows about where its data came from (C4).
//
// The service worker (public/sw.js) answers API requests from the network when
// it can and from its saved copy when it cannot, and marks the saved copy with
// x-sw-source: cache and x-sw-stored-at. apiFetcher reports every response here;
// the offline banner reads the result. A URL stays "saved" until a response for
// it comes from the network again, so the banner cannot disappear while a
// number on screen is still an old one.

export const SW_SOURCE_HEADER = 'x-sw-source'
export const SW_STORED_AT_HEADER = 'x-sw-stored-at'

/** Cache names the service worker owns. Asset caches hold no user data. */
const USER_DATA_CACHE_PREFIXES = ['it-data-', 'it-shell-']

export type OfflineStatus = {
  online: boolean
  /** At least one response on screen came from the saved copy. */
  showingSavedData: boolean
  /** When the oldest saved response on screen was stored, if known. */
  oldestSavedAt: number | null
}

type HeaderSource = { get(name: string): string | null }

// url -> when the saved copy was stored (null if unknown) and when it was shown.
const savedResponses = new Map<string, { storedAt: number | null; shownAt: number }>()
let pruneTimer: ReturnType<typeof setTimeout> | null = null

/**
 * After reconnecting, mounted SWR hooks refetch and clear their own entries.
 * Entries for components no longer on screen would never be refetched, and
 * would keep the banner up while everything visible is live; they are dropped
 * once the refetches have had time to land.
 */
export const RECONNECT_GRACE_MS = 10_000
const listeners = new Set<() => void>()
let online = typeof navigator === 'undefined' ? true : navigator.onLine !== false
let snapshot: OfflineStatus = computeSnapshot()

function computeSnapshot(): OfflineStatus {
  let oldest: number | null = null
  for (const { storedAt } of savedResponses.values()) {
    if (storedAt !== null && (oldest === null || storedAt < oldest)) oldest = storedAt
  }
  return { online, showingSavedData: savedResponses.size > 0, oldestSavedAt: oldest }
}

function emit() {
  snapshot = computeSnapshot()
  for (const listener of listeners) listener()
}

/** Record where the response for `url` came from. */
export function noteApiResponse(url: string, headers: HeaderSource | undefined | null): void {
  const source = headers?.get(SW_SOURCE_HEADER) ?? null
  if (source === 'cache') {
    const storedAt = Number(headers?.get(SW_STORED_AT_HEADER))
    savedResponses.set(url, {
      storedAt: Number.isFinite(storedAt) && storedAt > 0 ? storedAt : null,
      shownAt: Date.now(),
    })
    emit()
  } else if (source === null && savedResponses.delete(url)) {
    // A network response replaces the saved one on screen.
    emit()
  }
  // 'offline' means nothing was saved either: the request failed and the page
  // shows its error state, which is not saved data.
}

export function setOnline(value: boolean): void {
  if (value === online) return
  online = value
  if (pruneTimer) clearTimeout(pruneTimer)
  pruneTimer = null
  if (value) {
    const reconnectedAt = Date.now()
    pruneTimer = setTimeout(() => {
      pruneTimer = null
      let changed = false
      for (const [url, entry] of savedResponses) {
        if (entry.shownAt <= reconnectedAt) {
          savedResponses.delete(url)
          changed = true
        }
      }
      if (changed) emit()
    }, RECONNECT_GRACE_MS)
  }
  emit()
}

export function getOfflineStatus(): OfflineStatus {
  return snapshot
}

const SERVER_SNAPSHOT: OfflineStatus = { online: true, showingSavedData: false, oldestSavedAt: null }
export function getServerOfflineStatus(): OfflineStatus {
  return SERVER_SNAPSHOT
}

export function subscribeOfflineStatus(listener: () => void): () => void {
  listeners.add(listener)
  if (listeners.size === 1 && typeof window !== 'undefined') {
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    setOnline(navigator.onLine !== false)
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && typeof window !== 'undefined') {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }
}

function handleOnline() {
  setOnline(true)
}
function handleOffline() {
  setOnline(false)
}

/** The banner's text, or null when everything on screen is live. */
export function describeOfflineStatus(status: OfflineStatus, locale = 'es-MX'): string | null {
  if (status.showingSavedData) {
    const base = 'Estás viendo datos guardados, sin conexión.'
    if (status.oldestSavedAt === null) return base
    const when = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date(status.oldestSavedAt),
    )
    // es-MX writes times as "1:01 a.m.", which already ends the sentence.
    return `${base} Guardados el ${when}${when.endsWith('.') ? '' : '.'}`
  }
  if (!status.online) return 'Sin conexión. Los datos no se actualizarán hasta que vuelvas a estar en línea.'
  return null
}

/**
 * Delete the saved pages and API responses. Called on sign-out and sign-in so a
 * shared device never shows one person's portfolio to the next, online or not.
 * Runs from the page, so it does not depend on the service worker being awake.
 */
export async function clearOfflineUserData(): Promise<void> {
  savedResponses.clear()
  emit()
  if (typeof caches === 'undefined') return
  try {
    const keys = await caches.keys()
    await Promise.all(
      keys
        .filter((key) => USER_DATA_CACHE_PREFIXES.some((prefix) => key.startsWith(prefix)))
        .map((key) => caches.delete(key)),
    )
  } catch {
    // Storage can be unavailable (private mode); there is nothing saved then.
  }
}

/** Test hook. */
export function resetOfflineStatusForTests(): void {
  savedResponses.clear()
  listeners.clear()
  if (pruneTimer) clearTimeout(pruneTimer)
  pruneTimer = null
  online = true
  snapshot = computeSnapshot()
}
