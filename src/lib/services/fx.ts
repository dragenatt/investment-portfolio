// Converting a price into the currency the reader is looking at — pure, no I/O.
//
// The value chart summed provider closes straight into a total: AAPL in
// dollars, FEMSAUBD.MX in pesos, SPCX34.SA in reais and ^N225 in yen, all added
// together as though they were the same unit. The page then printed the result
// next to a header already converted to the book's base currency, so the same
// number appeared twice on one screen a factor of seventeen apart.
//
// Two things make an honest conversion possible here, and both were checked
// against the live providers before this was written:
//
//   - the quote currency is knowable per symbol (the provider returns it), and
//   - the FX pairs have daily HISTORY, so each date can use ITS OWN rate.
//
// That second point is why this converts date by date rather than applying
// today's rate to the whole series. Today's rate across five months of history
// would be a defensible simplification, but it would be an assumption, and an
// unnecessary one when the real series is one fetch away.

/** Rates expressed as "one USD buys this much of X", by date. USD is always 1. */
export type RateSeries = Record<string, Record<string, number>>

/** The provider's symbol for the USD→currency pair. */
export function fxPairSymbol(currency: string): string | null {
  const code = currency?.toUpperCase()
  if (!code || code === 'USD') return null
  return `USD${code}=X`
}

/**
 * The rate on a date, or the last one known before it.
 *
 * FX trades on days some equity markets do not and vice versa, so an exact
 * match is not guaranteed even when both series are healthy. Carrying the last
 * known rate forward is what every data vendor does; carrying one BACKWARD to
 * cover a date before the series starts is the only other option and is worse,
 * so it is done only when there is no earlier rate at all — and the caller is
 * told, through `missing`, when that happened.
 */
export function rateOn(series: Record<string, number> | undefined, date: string): number | null {
  if (!series) return null
  const exact = series[date]
  if (exact !== undefined && Number.isFinite(exact) && exact > 0) return exact

  let best: string | null = null
  let earliest: string | null = null
  for (const key of Object.keys(series)) {
    if (earliest === null || key < earliest) earliest = key
    if (key <= date && (best === null || key > best)) best = key
  }
  const chosen = best ?? earliest
  if (chosen === null) return null
  const value = series[chosen]
  return Number.isFinite(value) && value > 0 ? value : null
}

export type ConversionInputs = {
  /** symbol -> the currency its closes are quoted in. */
  currencyBySymbol: Record<string, string>
  /** The currency to express everything in. */
  base: string
  /** currency -> date -> "one USD buys this much". USD need not appear. */
  usdRates: RateSeries
}

export type Conversion = {
  /** Multiply a close of `symbol` on `date` by this to get `base`. */
  factor: (symbol: string, date: string) => number
  /** Symbols whose currency could not be resolved, valued as if already in base. */
  unknownCurrency: string[]
  /** Symbols whose currency is known but whose rate was not, valued as if already in base. */
  missingRate: string[]
  /** Currencies actually involved, base included. */
  currencies: string[]
}

/**
 * A per-symbol, per-date multiplier into the base currency.
 *
 * A symbol whose currency or rate is unknown converts at 1 — it is left in
 * whatever unit it arrived in — and is REPORTED rather than silently mixed in.
 * Dropping it instead would make the book appear to shrink, which is a worse
 * lie than a total with a stated gap in it.
 */
export function buildConversion(inputs: ConversionInputs): Conversion {
  const base = (inputs.base || 'USD').toUpperCase()
  const unknownCurrency: string[] = []
  const missingRate: string[] = []
  const currencies = new Set<string>([base])

  const cache = new Map<string, number | null>()
  const usdToBase = (date: string): number | null => {
    if (base === 'USD') return 1
    return rateOn(inputs.usdRates[base], date)
  }

  const factor = (symbol: string, date: string): number => {
    const key = `${symbol}|${date}`
    const cached = cache.get(key)
    if (cached !== undefined) return cached ?? 1

    const quoted = (inputs.currencyBySymbol[symbol] ?? '').toUpperCase()
    if (!quoted) {
      if (!unknownCurrency.includes(symbol)) unknownCurrency.push(symbol)
      cache.set(key, null)
      return 1
    }
    currencies.add(quoted)
    if (quoted === base) {
      cache.set(key, 1)
      return 1
    }

    // quoted -> USD -> base. One USD buys usdRates[quoted] of the quote
    // currency, so a price in that currency is worth price / that in USD.
    const usdPerQuote = quoted === 'USD' ? 1 : rateOn(inputs.usdRates[quoted], date)
    const basePerUsd = usdToBase(date)
    if (usdPerQuote === null || basePerUsd === null) {
      if (!missingRate.includes(symbol)) missingRate.push(symbol)
      cache.set(key, null)
      return 1
    }

    const value = (1 / usdPerQuote) * basePerUsd
    cache.set(key, value)
    return value
  }

  return {
    factor,
    get unknownCurrency() { return unknownCurrency },
    get missingRate() { return missingRate },
    get currencies() { return [...currencies] },
  }
}
