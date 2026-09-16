import useSWR from 'swr'
import { useEffect, useMemo, useState } from 'react'
import { apiFetcher } from '@/lib/api/fetcher'
import { createClient } from '@/lib/supabase/client'
import type { BatchQuote } from '@/lib/services/market'
import {
  mergePriceUpdate,
  pollIntervalFor,
  realtimeSymbolFilter,
  reconnectDelayMs,
  type ChannelState,
  type PriceUpdate,
} from '@/lib/services/live-prices'

/**
 * Prices for a set of symbols, pushed over Supabase Realtime (C2).
 *
 * The first load still comes from /api/market/batch. After that, changes to
 * current_prices for these symbols arrive on a Realtime channel and are merged
 * into the same SWR entry, so every component reading the prices — portfolio
 * value, daily P&L, the price cells — updates without a request. Polling drops
 * to a five-minute heartbeat while the channel is up and returns to every 60
 * seconds if it goes down, so a broken socket degrades to the old behaviour
 * instead of to stale numbers.
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
      refreshInterval: pollIntervalFor(channelState),
      dedupingInterval: 30_000,
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
    let attempt = 0
    let disposed = false

    const subscribe = () => {
      channel = supabase
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
        .subscribe((status) => {
          if (disposed) return
          setChannelState(status as ChannelState)
          if (status === 'SUBSCRIBED') {
            attempt = 0
            return
          }
          // supabase-js rejoins on its own after a dropped socket; an errored or
          // timed-out join is torn down and retried with backoff instead.
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            const failed = channel
            channel = null
            if (failed) supabase.removeChannel(failed)
            retryTimer = setTimeout(() => {
              if (!disposed) subscribe()
            }, reconnectDelayMs(attempt++))
          }
        })
    }

    subscribe()

    return () => {
      disposed = true
      clearTimeout(retryTimer)
      if (channel) supabase.removeChannel(channel)
    }
  }, [key, mutate])

  return { ...swr, channelState }
}
