// Price freshness — pure functions, no I/O.
//
// The provider chain (primary, secondary, cache) always produces a number, and
// that is the danger: a price served from a two-day-old cache looks exactly like
// a price fetched a second ago. Roadmap rule: never present cached data as
// current. This module turns a timestamp and the tier that answered into a
// status the interface is obliged to show.

export type FreshnessStatus = 'live' | 'delayed' | 'cached' | 'unavailable'

/** Which link of the provider chain produced the price. */
export type PriceTier = 'primary' | 'secondary' | 'cache'

export type Freshness = {
  status: FreshnessStatus
  /** Seconds since the price was fetched. Null when there is no price. */
  ageSeconds: number | null
  fetchedAt: string | null
  provider: string | null
  tier: PriceTier | null
  /** Plain-language wording, safe to render as-is. */
  label: string
  /** True only for a recent read from a live provider. Anything else must not be shown as today's price. */
  isCurrent: boolean
}

export type ClassifyInput = {
  fetchedAt: string | null | undefined
  provider?: string | null
  tier?: PriceTier
  /** Reference "now". Injected so classification is reproducible. */
  asOf?: Date
  /** Below this age a provider read counts as live. */
  liveWithinSeconds?: number
  /** Below this age it counts as delayed; past it, cached. */
  delayedWithinSeconds?: number
}

// Quotes on the free tiers are already 15 minutes behind the tape, so "live"
// here means "as live as this app can be", not "real time".
const LIVE_WITHIN_SECONDS = 15 * 60
const DELAYED_WITHIN_SECONDS = 24 * 60 * 60

function humanAge(seconds: number): string {
  if (seconds < 90) return `${seconds}s ago`
  if (seconds < 5400) return `${Math.round(seconds / 60)} min ago`
  if (seconds < 172800) return `${Math.round(seconds / 3600)} h ago`
  return `${Math.round(seconds / 86400)} days ago`
}

/**
 * Turn a fetch timestamp and the tier that answered into a freshness verdict.
 *
 * The tier is not just decoration: a price read out of the cache is `cached`
 * however recently it was written, because the cache being warm says nothing
 * about whether the market has moved since.
 */
export function classifyFreshness(input: ClassifyInput): Freshness {
  const asOf = input.asOf ?? new Date()
  const provider = input.provider ?? null
  const tier = input.tier ?? null

  const parsed = input.fetchedAt ? Date.parse(input.fetchedAt) : Number.NaN
  if (!Number.isFinite(parsed)) {
    return {
      status: 'unavailable',
      ageSeconds: null,
      fetchedAt: null,
      provider,
      tier,
      label: 'No price available for this asset.',
      isCurrent: false,
    }
  }

  // A provider clock running slightly ahead should not produce a negative age.
  const ageSeconds = Math.max(0, Math.round((asOf.getTime() - parsed) / 1000))
  const liveWithin = input.liveWithinSeconds ?? LIVE_WITHIN_SECONDS
  const delayedWithin = input.delayedWithinSeconds ?? DELAYED_WITHIN_SECONDS

  let status: FreshnessStatus
  if (tier === 'cache') status = 'cached'
  else if (ageSeconds <= liveWithin) status = 'live'
  else if (ageSeconds <= delayedWithin) status = 'delayed'
  else status = 'cached'

  const via = provider ? ` via ${provider}` : ''
  const label =
    status === 'live'
      ? `Updated ${humanAge(ageSeconds)}${via}.`
      : status === 'delayed'
        ? `Delayed — last updated ${humanAge(ageSeconds)}${via}.`
        : `Saved price from ${humanAge(ageSeconds)}${via}. This is not the current price.`

  return {
    status,
    ageSeconds,
    fetchedAt: new Date(parsed).toISOString(),
    provider,
    tier,
    label,
    isCurrent: status === 'live',
  }
}

/** Convenience for the stored price rows, which carry a snake_case `fetched_at`. */
export function freshnessOf(
  row: { fetched_at?: string | null } | null | undefined,
  options: { asOf?: Date; provider?: string | null; tier?: PriceTier } = {},
): Freshness {
  return classifyFreshness({
    fetchedAt: row?.fetched_at ?? null,
    provider: options.provider ?? null,
    tier: options.tier,
    asOf: options.asOf,
  })
}
