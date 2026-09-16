// Price freshness — pure functions, no I/O.
//
// The provider chain (primary, secondary, cache) always produces a number, and
// that is the danger: a price served from a two-day-old cache looks exactly like
// a price fetched a second ago. Roadmap rule: never present cached data as
// current. This module turns a timestamp and the tier that answered into a
// status the interface is obliged to show.
//
// It is the ONLY place the app decides whether a price is current. The
// allocation tab used to decide it with `quote === undefined` and the portfolio
// page with `!livePrices[symbol]` — two binary answers to a four-way question,
// neither of which could tell a price fetched a minute ago from one saved on
// Friday. tests/lint/freshness-single-source.test.ts keeps a third from
// appearing.

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

/**
 * The four states by name, for a screen with room for a word and not a
 * sentence. "Al día" rather than "en vivo": the free quotes this app reads are
 * already fifteen minutes behind the market, and saying "live" would promise
 * what they are not.
 */
export const FRESHNESS_STATUS_LABELS: Record<FreshnessStatus, string> = {
  live: 'Al día',
  delayed: 'Con retraso',
  cached: 'Guardado',
  unavailable: 'Sin precio',
}

function humanAge(seconds: number): string {
  if (seconds < 90) return `hace ${seconds} s`
  if (seconds < 5400) return `hace ${Math.round(seconds / 60)} min`
  if (seconds < 172800) return `hace ${Math.round(seconds / 3600)} h`
  return `hace ${Math.round(seconds / 86400)} días`
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
      label: 'No hay precio para este activo; se muestra el costo promedio en su lugar.',
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

  const via = provider ? ` (${provider})` : ''
  const label =
    status === 'live'
      ? `Actualizado ${humanAge(ageSeconds)}${via}.`
      : status === 'delayed'
        ? `Con retraso: actualizado ${humanAge(ageSeconds)}${via}.`
        : `Precio guardado ${humanAge(ageSeconds)}${via}. No es el precio actual.`

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

/**
 * The same verdict for a quote from /api/market/batch, which carries its own
 * `fetchedAt`.
 *
 * A quote with no usable price is unavailable whatever its timestamp says — the
 * screen is showing the average cost in its place. A price with no timestamp is
 * a number whose age nobody knows, so it is reported as saved, not as current.
 */
export function freshnessOfQuote(
  quote: { price?: number | null; fetchedAt?: string | null } | null | undefined,
  options: { asOf?: Date; provider?: string | null } = {},
): Freshness {
  const price = quote?.price
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) {
    return classifyFreshness({ fetchedAt: null, provider: options.provider, asOf: options.asOf })
  }
  if (!quote?.fetchedAt || !Number.isFinite(Date.parse(quote.fetchedAt))) {
    return {
      status: 'cached',
      ageSeconds: null,
      fetchedAt: null,
      provider: options.provider ?? null,
      tier: null,
      label: 'Precio guardado de antigüedad desconocida. No es el precio actual.',
      isCurrent: false,
    }
  }
  return classifyFreshness({ fetchedAt: quote.fetchedAt, provider: options.provider, asOf: options.asOf })
}
