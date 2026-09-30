import useSWR from 'swr'
import { useEffect, useMemo, useState } from 'react'
import { apiFetcher } from '@/lib/api/fetcher'
import { createClient } from '@/lib/supabase/client'
import type { BatchQuote } from '@/lib/services/market'
import {
  LIVE_POLL_MS,
  mergePriceUpdate,
  realtimeSymbolFilter,
  reconnectDelayMs,
  type ChannelState,
  type PriceUpdate,
} from '@/lib/services/live-prices'

/**
 * Prices for a set of symbols: polled from /api/market/batch every
 * LIVE_POLL_MS while the screen is visible, and pushed over Supabase Realtime
 * (C2) whenever anyone else's poll writes a newer one to current_prices.
 * Either way the price lands in the same SWR entry, so every component reading
 * it — portfolio value, daily P&L, the price cells, the chart's last point —
 * updates together.
 *
 * Polling used to drop to every five minutes while the channel was up. The
 * channel only carries what polls write, so that was also how often prices
 * moved (live-prices.ts).
 *
 * A channel that keeps failing is given up after MAX_REALTIME_FAILURES tries in
 * a row, socket included, and polling carries on alone; coming back online
 * starts the tries over.
 *
 * The subscription is filtered to these symbols. current_prices is shared market
 * data every signed-in user may read, so the filter — not RLS — is what keeps a
 * user from receiving every price anyone else is looking at. Anonymous visitors
 * receive nothing: Realtime applies the table's RLS, which admits only
 * authenticated readers.
 */
export function useLivePrices(symbols: string[]) {
  const key = useMemo(() => {
    const unique = [...new Set(symbols)].sort()
    return unique.length > 0 ? unique.join(',') : null
  }, [symbols])

  const [channelState, setChannelState] = useState<ChannelState>('CONNECTING')

  // Untyped, as it has always been: the pages reading this assume a non-null
  // price, which BatchQuote does not promise. Tightening that is its own change.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const swr = useSWR<any>(
    key ? `/api/market/batch?symbols=${encodeURIComponent(key)}` : null,
    apiFetcher,
    {
      // Paused while the tab is hidden (SWR's default); every poll is a
      // provider call on the server once the quote cache expires.
      refreshInterval: LIVE_POLL_MS,
      // Below the poll interval: SWR skips a revalidation that falls inside
      // it, and at 30 seconds it halved how often a 15-second poll happened.
      dedupingInterval: 2_000,
      keepPreviousData: true,
    },
  )
  const { mutate } = swr

  useEffect(() => {
    if (!key) return
    const filter = realtimeSymbolFilter(key.split(','))
    if (!filter) return

    const supabase = createClient()
    let channel: ReturnType<typeof supabase.channel> | null = null
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    let failures = 0
    let disposed = false
    // The last failed channel's removal. A channel is looked up by topic, so
    // subscribing again before the old one has left would get the old one back.
    let removal: Promise<unknown> = Promise.resolve()

    const resubscribe = () => {
      void removal.then(() => {
        if (!disposed && !channel) subscribe()
      })
    }

    const subscribe = () => {
      const attempt = supabase
        .channel(`live-prices:${key}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'current_prices', filter },
          (payload) => {
            const row = payload.new as Partial<PriceUpdate> | undefined
            if (!row?.symbol) return
            mutate(
              (current: Record<string, BatchQuote> | undefined) =>
                mergePriceUpdate(current, {
                  symbol: row.symbol!,
                  price: row.price,
                  change_pct: row.change_pct,
                  fetched_at: row.fetched_at,
                }) ?? current,
              { revalidate: false },
            )
          },
        )
      channel = attempt
      attempt.subscribe((status) => {
        // A channel already dropped still reports its own closing; only the
        // live one speaks for the screen.
        if (disposed || channel !== attempt) return
        setChannelState(status as ChannelState)
        if (status === 'SUBSCRIBED') {
          failures = 0
          return
        }
        // supabase-js rejoins on its own after a dropped socket; an errored or
        // timed-out join is torn down and retried with backoff instead — until
        // it has failed often enough to say it will keep failing.
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          channel = null
          removal = supabase.removeChannel(attempt)
          const delay = reconnectDelayMs(++failures)
          if (delay !== null) {
            retryTimer = setTimeout(resubscribe, delay)
            return
          }
          setChannelState('CLOSED')
          // Giving up has to reach the socket too. Phoenix redials one that
          // never opened every ten seconds on its own, and the client only
          // disconnects an idle socket fifty seconds after its last channel
          // leaves: a refused upgrade every ten seconds until then.
          void removal.then(() => {
            if (supabase.getChannels().length === 0) void supabase.realtime.disconnect()
          })
        }
      })
    }

    // A network that comes back is a new situation, not a sixth failure: start
    // over with a full set of attempts.
    const onOnline = () => {
      if (disposed || channel) return
      clearTimeout(retryTimer)
      failures = 0
      resubscribe()
    }
    window.addEventListener('online', onOnline)

    subscribe()

    return () => {
      disposed = true
      clearTimeout(retryTimer)
      window.removeEventListener('online', onOnline)
      if (channel) supabase.removeChannel(channel)
    }
  }, [key, mutate])

  return { ...swr, channelState }
}
