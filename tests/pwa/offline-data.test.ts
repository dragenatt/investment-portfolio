import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  clearOfflineUserData,
  describeOfflineStatus,
  getOfflineStatus,
  noteApiResponse,
  RECONNECT_GRACE_MS,
  resetOfflineStatusForTests,
  setOnline,
  subscribeOfflineStatus,
} from '@/lib/pwa/offline-data'

const saved = (storedAt: number) => new Headers({ 'x-sw-source': 'cache', 'x-sw-stored-at': String(storedAt) })
const live = () => new Headers({ 'content-type': 'application/json' })

beforeEach(() => resetOfflineStatusForTests())
afterEach(() => vi.useRealTimers())

describe('offline data status', () => {
  it('starts with nothing to report', () => {
    expect(getOfflineStatus()).toEqual({ online: true, showingSavedData: false, oldestSavedAt: null })
    expect(describeOfflineStatus(getOfflineStatus())).toBeNull()
  })

  it('flags saved responses and reports the oldest one', () => {
    noteApiResponse('/api/portfolio/p1', saved(2_000))
    noteApiResponse('/api/market/batch?symbols=AAPL', saved(1_000))
    expect(getOfflineStatus()).toMatchObject({ showingSavedData: true, oldestSavedAt: 1_000 })
  })

  it('stays flagged until every saved response has been replaced from the network', () => {
    noteApiResponse('/api/portfolio/p1', saved(2_000))
    noteApiResponse('/api/rates', saved(1_000))
    noteApiResponse('/api/rates', live())
    expect(getOfflineStatus()).toMatchObject({ showingSavedData: true, oldestSavedAt: 2_000 })
    noteApiResponse('/api/portfolio/p1', live())
    expect(getOfflineStatus().showingSavedData).toBe(false)
  })

  it('does not count a failed offline request as saved data', () => {
    noteApiResponse('/api/rates', new Headers({ 'x-sw-source': 'offline' }))
    expect(getOfflineStatus().showingSavedData).toBe(false)
  })

  it('tolerates responses without headers', () => {
    expect(() => noteApiResponse('/api/rates', undefined)).not.toThrow()
  })

  it('notifies subscribers only when something changes', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeOfflineStatus(listener)
    listener.mockClear()
    noteApiResponse('/api/rates', live())
    expect(listener).not.toHaveBeenCalled()
    noteApiResponse('/api/rates', saved(1))
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
  })

  it('keeps the snapshot identity stable between changes (useSyncExternalStore)', () => {
    const first = getOfflineStatus()
    expect(getOfflineStatus()).toBe(first)
    noteApiResponse('/api/rates', saved(1))
    expect(getOfflineStatus()).not.toBe(first)
  })

  it('after reconnecting, drops entries nothing refetched within the grace period', () => {
    vi.useFakeTimers()
    setOnline(false)
    noteApiResponse('/api/portfolio/old-page', saved(1_000))
    setOnline(true)
    expect(getOfflineStatus().showingSavedData).toBe(true)
    vi.advanceTimersByTime(RECONNECT_GRACE_MS)
    expect(getOfflineStatus().showingSavedData).toBe(false)
  })

  it('keeps entries marked again after reconnecting (the network is still failing)', () => {
    vi.useFakeTimers()
    setOnline(false)
    noteApiResponse('/api/rates', saved(1_000))
    setOnline(true)
    vi.advanceTimersByTime(1)
    noteApiResponse('/api/rates', saved(1_000))
    vi.advanceTimersByTime(RECONNECT_GRACE_MS)
    expect(getOfflineStatus().showingSavedData).toBe(true)
  })
})

describe('describeOfflineStatus', () => {
  it('uses the roadmap wording and says when the data was saved', () => {
    const message = describeOfflineStatus({ online: false, showingSavedData: true, oldestSavedAt: Date.UTC(2026, 8, 14, 18, 30) })!
    expect(message.startsWith('Estás viendo datos guardados, sin conexión.')).toBe(true)
    expect(message).toContain('Guardados el')
    expect(message).toContain('2026')
  })

  it('ends with exactly one period, including after "a.m."', () => {
    // Seen in the browser: "Guardados el 14 sep 2026, 1:01 a.m.."
    for (const hour of [1, 13]) {
      const message = describeOfflineStatus({ online: false, showingSavedData: true, oldestSavedAt: new Date(2026, 8, 14, hour, 1).getTime() })!
      expect(message.endsWith('..')).toBe(false)
      expect(message.endsWith('.')).toBe(true)
    }
  })

  it('still warns when the saved date is unknown', () => {
    expect(describeOfflineStatus({ online: true, showingSavedData: true, oldestSavedAt: null })).toBe(
      'Estás viendo datos guardados, sin conexión.',
    )
  })

  it('warns when offline even before any saved data is shown', () => {
    expect(describeOfflineStatus({ online: false, showingSavedData: false, oldestSavedAt: null })).toMatch(/^Sin conexión\./)
  })
})

describe('clearOfflineUserData', () => {
  it("deletes saved pages and data but leaves the build's static files", async () => {
    const deleted: string[] = []
    vi.stubGlobal('caches', {
      keys: async () => ['it-data-v1', 'it-shell-abc', 'it-assets-abc', 'it-offline-abc', 'other'],
      delete: async (key: string) => {
        deleted.push(key)
        return true
      },
    })
    noteApiResponse('/api/rates', saved(1))
    await clearOfflineUserData()
    expect(deleted.sort()).toEqual(['it-data-v1', 'it-shell-abc'])
    expect(getOfflineStatus().showingSavedData).toBe(false)
    vi.unstubAllGlobals()
  })

  it('does not throw where storage is unavailable', async () => {
    vi.stubGlobal('caches', {
      keys: async () => {
        throw new DOMException('denied', 'SecurityError')
      },
    })
    await expect(clearOfflineUserData()).resolves.toBeUndefined()
    vi.unstubAllGlobals()
  })
})
