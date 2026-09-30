import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { SWRConfig } from 'swr'
import type { ReactNode } from 'react'
import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js'

// A socket the server refuses closes in the browser exactly like a dropped
// network: code 1006, and the 401 behind it is not exposed. The hook used to
// resubscribe every thirty seconds forever while phoenix, underneath, redialled
// on its own every ten, so one open tab with a bad key sent thousands of refused
// upgrades a day. These run the real supabase-js client over a transport that
// refuses every connection, the way the gateway did.

const state = vi.hoisted(() => ({ client: null as unknown as SupabaseClient }))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => state.client }))
vi.mock('@/lib/api/fetcher', () => ({ apiFetcher: vi.fn(async () => ({})) }))

const { useLivePrices } = await import('@/lib/hooks/use-live-prices')
const { apiFetcher } = await import('@/lib/api/fetcher')
const { MAX_REALTIME_FAILURES } = await import('@/lib/services/live-prices')

// Shaped like an anon key; signs nothing.
const KEY = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.dGVzdC1zaWduYXR1cmU'

/** Every socket the client has opened. */
let dialled: string[] = []

/** A WebSocket whose upgrade is always refused, a moment after it is opened. */
class RefusedSocket {
  readyState = 0
  bufferedAmount = 0
  binaryType = 'arraybuffer'
  onopen: (() => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onclose: ((event: { code: number; reason: string; wasClean: boolean }) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null

  constructor(readonly url: string) {
    dialled.push(url)
    setTimeout(() => {
      this.readyState = 3
      this.onerror?.(new Event('error'))
      this.onclose?.({ code: 1006, reason: '', wasClean: false })
    }, 50)
  }

  send() {}
  close() {
    this.readyState = 3
  }
}

function wrapper({ children }: { children: ReactNode }) {
  return <SWRConfig value={{ provider: () => new Map() }}>{children}</SWRConfig>
}

async function wait(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.mocked(apiFetcher).mockClear()
  dialled = []
  state.client = createSupabaseClient('https://abcdefghijklmnop.supabase.co', KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    realtime: { transport: RefusedSocket as never },
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useLivePrices when every socket is refused', () => {
  it('stops dialling the moment it gives up, and leaves the prices to polling', async () => {
    const { result, unmount } = renderHook(() => useLivePrices(['AAPL']), { wrapper })
    for (let second = 0; second < 600 && result.current.channelState !== 'CLOSED'; second++) await wait(1_000)
    expect(result.current.channelState).toBe('CLOSED')
    const attempts = dialled.length
    // Its own tries, and phoenix redialling in between: a handful, not hundreds.
    expect(attempts).toBeGreaterThan(0)
    expect(attempts).toBeLessThanOrEqual(2 * MAX_REALTIME_FAILURES)

    const polls = vi.mocked(apiFetcher).mock.calls.length
    await wait(60 * 60_000)

    // Not one more — not even while an idle socket would wait to be closed.
    expect(dialled.length).toBe(attempts)
    // Every fifteen seconds for an hour, give or take the edges.
    expect(vi.mocked(apiFetcher).mock.calls.length - polls).toBeGreaterThan(200)
    unmount()
  })

  it('tries again when the browser comes back online', async () => {
    const { unmount } = renderHook(() => useLivePrices(['AAPL']), { wrapper })
    await wait(15 * 60_000)
    const attempts = dialled.length
    await wait(15 * 60_000)
    expect(dialled.length).toBe(attempts)

    await act(async () => {
      window.dispatchEvent(new Event('online'))
    })
    await wait(1_000)

    expect(dialled.length).toBeGreaterThan(attempts)
    unmount()
  })
})
