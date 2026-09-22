'use client'

import { useSyncExternalStore } from 'react'
import { useTranslation } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { elapsed, usMarketState, type UsMarketState } from '@/lib/utils/market-hours'

type Quote = { fetchedAt?: string } | null | undefined

/** A price not refreshed for this long while the market is open is called stale. */
const STALE_AFTER_MS = 90_000

// A clock that ticks once a second, in the browser only. On the server there
// is no "now" to agree with the client about, so nothing time-based renders
// until the page has hydrated.
function subscribe(tick: () => void) {
  const id = setInterval(tick, 1000)
  return () => clearInterval(id)
}
const clientNow = () => Math.floor(Date.now() / 1000) * 1000
const serverNow = () => null

/**
 * The line under the portfolio value that says the prices are alive: whether
 * the US market is open, and how long ago the prices on screen were fetched —
 * the quotes' own fetch time, which the server now reports honestly.
 *
 * Prices refresh every 15 seconds, but a figure that does not move could be a
 * quiet minute, a closed market or a broken feed, and nothing on the dashboard
 * told them apart.
 */
export function LiveStatus({ quotes }: { quotes: Record<string, Quote> | undefined }) {
  const { t } = useTranslation()
  const now = useSyncExternalStore(subscribe, clientNow, serverNow)
  if (now === null) return null

  const market = usMarketState(new Date(now))
  const fetched = Object.values(quotes ?? {})
    .map((q) => (q?.fetchedAt ? Date.parse(q.fetchedAt) : Number.NaN))
    .filter(Number.isFinite)
  const latest = fetched.length > 0 ? Math.max(...fetched) : null

  const marketLabel: Record<UsMarketState, string> = {
    open: t.dashboard.us_market_open,
    closed: t.dashboard.us_market_closed,
    weekend: t.dashboard.us_market_weekend,
    holiday: t.dashboard.us_market_holiday,
  }

  const ago = (then: number) => {
    const { n, unit } = elapsed(then, now)
    const template = unit === 's' ? t.dashboard.ago_s : unit === 'min' ? t.dashboard.ago_min : t.dashboard.ago_h
    return template.replace('{n}', String(n))
  }

  const stale = latest !== null && market === 'open' && now - latest > STALE_AFTER_MS
  const freshness =
    latest === null
      ? t.dashboard.prices_loading
      : (stale ? t.dashboard.prices_stale : t.dashboard.prices_checked).replace('{ago}', ago(latest))

  return (
    <p className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="live-status">
      <span
        aria-hidden="true"
        className={cn(
          'inline-block h-2 w-2 rounded-full',
          market === 'open' ? (stale ? 'bg-amber-500' : 'bg-gain animate-pulse') : 'bg-muted-foreground/50',
        )}
      />
      <span>{marketLabel[market]}</span>
      <span aria-hidden="true">·</span>
      <span className={cn(stale && 'text-amber-700 dark:text-amber-300')}>{freshness}</span>
    </p>
  )
}
