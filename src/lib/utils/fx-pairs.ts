// Which exchange rates the app has to know, and how to name them.
//
// /api/rates held a fixed list of two pairs — USDMXN=X and USDEUR=X — because
// those are the two currencies besides dollars that the interface offers as a
// display currency. But the currency a screen displays in and the currency an
// asset trades in are different questions, and nothing limited the second one.
// Production holds ^N225, quoted in yen, and SPCX34.SA, quoted in reais.
// Neither had a pair, so neither could be converted, and the amounts went into
// totals as they came (see utils/currency.ts).
//
// The list is therefore built from what is actually held: the display
// currencies, always, plus every currency the stored quotes say something
// trades in.

/** Currencies the interface can be switched to; a rate must always exist. */
export const DISPLAY_CURRENCIES = ['MXN', 'EUR'] as const

/** Everything is quoted against the dollar, so the dollar needs no pair. */
export const BASE_CURRENCY = 'USD'

/**
 * Last-resort rates, used only when the provider is down AND no rate was ever
 * stored — a fresh database with Yahoo unreachable. Leaving the currency out
 * would be worse: an amount that cannot be converted is added as it stands.
 *
 * Each is a real observation, read from Yahoo on 2026-09-20, in units of the
 * currency per dollar. They go stale; they exist so that a first request with
 * nothing behind it is approximately right rather than silently wrong.
 *
 * A currency discovered at runtime with no constant here gets no rate rather
 * than a guessed one. To add one: read USD<CCY>=X, write it down with the date.
 */
export const LAST_RESORT_RATES: Record<string, number> = {
  MXN: 17.22,
  EUR: 0.87,
  JPY: 156.86,
  BRL: 5.14,
}

/** The symbol a USD→currency rate is stored under. */
export function pairFor(currency: string): string {
  return `${BASE_CURRENCY}${currency.toUpperCase()}=X`
}

/** The currency a stored pair is a rate for: USDJPY=X → JPY. */
export function currencyOfPair(pair: string): string | null {
  const match = /^USD([A-Z]{3})=X$/.exec(pair.toUpperCase())
  return match ? match[1] : null
}

/** A three-letter code, and not the base currency, which needs no rate. */
function isConvertibleCode(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Z]{3}$/.test(value) && value !== BASE_CURRENCY
}

/**
 * Every currency a rate is needed for: the display currencies, plus the ones
 * the stored quotes trade in. An FX pair's own row is stored with currency USD
 * and so contributes nothing, which is what we want — a rate is not an asset.
 */
export function currenciesToCover(rows: Array<{ currency?: string | null }>): string[] {
  const found = new Set<string>(DISPLAY_CURRENCIES)
  for (const row of rows) {
    const code = row.currency?.toUpperCase()
    if (isConvertibleCode(code)) found.add(code)
  }
  return [...found].sort()
}
