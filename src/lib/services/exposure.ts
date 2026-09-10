// Exposure — pure functions, no I/O.
//
// A weights chart shows what a portfolio holds. It does not show what the
// portfolio is BET ON, and the gap between those is where concentration hides:
// AAPL at 20% and MSFT at 20% are two ordinary positions and one 40% bet on
// technology, and nothing in a per-ticker view makes that visible.
//
// Two other exposures matter and are just as invisible per-ticker: the region a
// holding's business actually sits in, and the currency its price is quoted in.
// A Mexican investor holding US equities is running an exchange-rate position
// whether or not they meant to, and it can be larger than the equity call.

export type ExposureHolding = {
  symbol: string
  value: number
  sector: string | null
  currency: string
  /** Explicit country when the data has one. Trusted above every heuristic. */
  country?: string | null
}

export type ExposureBucket = {
  name: string
  value: number
  weightPct: number
  symbols: string[]
}

const UNKNOWN = 'Unknown'

/** Weight past which a bucket is worth naming as a concentration. */
const CONCENTRATION_THRESHOLD_PCT = 35

function usable(holdings: ExposureHolding[]): ExposureHolding[] {
  return holdings.filter((h) => Number.isFinite(h.value) && h.value > 0)
}

function bucketise(
  holdings: ExposureHolding[],
  keyOf: (h: ExposureHolding) => string,
): { buckets: ExposureBucket[]; total: number } {
  const items = usable(holdings)
  const total = items.reduce((sum, h) => sum + h.value, 0)
  if (total <= 0) return { buckets: [], total: 0 }

  const map = new Map<string, ExposureBucket>()
  for (const holding of items) {
    const key = keyOf(holding)
    const existing = map.get(key)
    if (existing) {
      existing.value += holding.value
      existing.symbols.push(holding.symbol)
    } else {
      map.set(key, { name: key, value: holding.value, weightPct: 0, symbols: [holding.symbol] })
    }
  }

  const buckets = [...map.values()]
    .map((b) => ({ ...b, weightPct: (b.value / total) * 100 }))
    .sort((a, b) => b.weightPct - a.weightPct)

  return { buckets, total }
}

// ─── Sector (P1-19) ─────────────────────────────────────────────────────────

export type HiddenConcentration = {
  name: string
  weightPct: number
  symbols: string[]
  message: string
}

export type SectorExposure = {
  buckets: ExposureBucket[]
  /**
   * A bucket that is oversized while none of its members is. This is the
   * concentration a per-ticker view cannot show, and the only one worth
   * calling "hidden" — a single 60% position is plainly visible already.
   */
  hiddenConcentration: HiddenConcentration | null
}

export function sectorExposure(holdings: ExposureHolding[]): SectorExposure {
  const { buckets, total } = bucketise(holdings, (h) => h.sector ?? UNKNOWN)
  if (buckets.length === 0) return { buckets: [], hiddenConcentration: null }

  const items = usable(holdings)
  let hidden: HiddenConcentration | null = null

  for (const bucket of buckets) {
    if (bucket.name === UNKNOWN) continue
    if (bucket.weightPct < CONCENTRATION_THRESHOLD_PCT) continue
    // Concentration only counts as hidden when it is built from several
    // positions. One big holding is already on the weights chart.
    if (bucket.symbols.length < 2) continue

    const largest = Math.max(
      ...items
        .filter((h) => bucket.symbols.includes(h.symbol))
        .map((h) => (h.value / total) * 100),
    )
    if (largest >= CONCENTRATION_THRESHOLD_PCT) continue

    hidden = {
      name: bucket.name,
      weightPct: bucket.weightPct,
      symbols: bucket.symbols,
      message:
        bucket.symbols.join(' + ') +
        ' are ' +
        bucket.weightPct.toFixed(0) +
        '% of the portfolio in ' +
        bucket.name +
        ', though no single one of them is larger than ' +
        largest.toFixed(0) +
        '%. They will tend to fall together.',
    }
    break
  }

  return { buckets, hiddenConcentration: hidden }
}

// ─── Geography (P1-19) ──────────────────────────────────────────────────────

export type RegionBasis = 'country' | 'symbol-suffix' | 'currency' | 'unknown'
export type InferredRegion = { region: string; basis: RegionBasis }

/**
 * Market suffixes that identify where an instrument trades. Trading venue is
 * not the same as where the business earns its money, which is why this is
 * reported as inferred rather than known.
 */
const SUFFIX_REGIONS: Record<string, string> = {
  MX: 'Mexico',
  DE: 'Europe',
  PA: 'Europe',
  AS: 'Europe',
  MC: 'Europe',
  MI: 'Europe',
  SW: 'Europe',
  L: 'Europe',
  TO: 'Canada',
  V: 'Canada',
  T: 'Japan',
  HK: 'Asia',
  SS: 'Asia',
  SZ: 'Asia',
  AX: 'Oceania',
  SA: 'Emerging markets',
  BA: 'Emerging markets',
}

const CURRENCY_REGIONS: Record<string, string> = {
  USD: 'United States',
  MXN: 'Mexico',
  EUR: 'Europe',
}

/**
 * Best guess at a holding's region, with the basis it used.
 *
 * The basis matters more than the answer. A currency-based guess is weak — a
 * dollar-denominated ETF can hold anything on earth — and a reader deciding
 * whether they are over-exposed to one economy deserves to know the difference
 * between "this is a Mexican company" and "this is priced in pesos".
 */
export function inferRegion(holding: {
  symbol: string
  currency: string
  country?: string | null
}): InferredRegion {
  if (holding.country && holding.country.trim().length > 0) {
    return { region: holding.country.trim(), basis: 'country' }
  }

  const parts = holding.symbol.split('.')
  if (parts.length > 1) {
    const suffix = parts[parts.length - 1].toUpperCase()
    const region = SUFFIX_REGIONS[suffix]
    if (region) return { region, basis: 'symbol-suffix' }
  }

  const byCurrency = CURRENCY_REGIONS[holding.currency?.toUpperCase() ?? '']
  if (byCurrency) return { region: byCurrency, basis: 'currency' }

  return { region: UNKNOWN, basis: 'unknown' }
}

export type GeographicExposure = {
  buckets: ExposureBucket[]
  confidence: 'stated' | 'inferred' | 'weak'
  caveat: string
}

export function geographicExposure(holdings: ExposureHolding[]): GeographicExposure {
  const items = usable(holdings)
  const bases = items.map((h) => inferRegion(h).basis)
  const { buckets } = bucketise(holdings, (h) => inferRegion(h).region)

  const allStated = bases.length > 0 && bases.every((b) => b === 'country')
  const anyCurrencyOnly = bases.some((b) => b === 'currency' || b === 'unknown')

  const confidence: GeographicExposure['confidence'] = allStated
    ? 'stated'
    : anyCurrencyOnly
      ? 'weak'
      : 'inferred'

  return {
    buckets,
    confidence,
    caveat:
      confidence === 'stated'
        ? 'Regions come from each holding stated country of domicile.'
        : 'Regions here are inferred from where an instrument trades and what it is priced in, ' +
          'not from where the underlying business earns its revenue. A US-listed fund can hold ' +
          'companies anywhere, and a global company earns everywhere — treat this as a rough map, ' +
          'not a measurement.',
  }
}

// ─── Currency (P1-20) ───────────────────────────────────────────────────────

export type CurrencyDecomposition = {
  assetEffectPct: number
  fxEffectPct: number
  /** The cross term: the asset move earned on top of the currency move. */
  interactionPct: number
  totalPct: number
  summary: string
}

/**
 * Split a return earned abroad into what the asset did and what the exchange
 * rate did.
 *
 *   (1 + r_local)(1 + f) - 1  =  r_local + f + r_local·f
 *
 * The three terms are the asset effect, the FX effect, and the interaction
 * between them, and they add to the whole exactly — which is what makes this a
 * decomposition rather than an approximation.
 *
 * `fxReturn` is the move of the holding's currency AGAINST the base currency, so
 * a positive value means the foreign currency strengthened and the holder gained
 * from it.
 */
export function decomposeCurrencyReturn(
  localReturn: number,
  fxReturn: number,
): CurrencyDecomposition | null {
  if (!Number.isFinite(localReturn) || !Number.isFinite(fxReturn)) return null

  const assetEffectPct = localReturn * 100
  const fxEffectPct = fxReturn * 100
  const interactionPct = localReturn * fxReturn * 100
  const totalPct = assetEffectPct + fxEffectPct + interactionPct

  const assetShare = Math.abs(assetEffectPct)
  const fxShare = Math.abs(fxEffectPct)

  let summary: string
  if (assetShare === 0 && fxShare === 0) {
    summary = 'Ni el activo ni el tipo de cambio se movieron en este periodo.'
  } else if (fxShare > assetShare) {
    summary =
      'El tipo de cambio explica la mayor parte de este resultado: aporto ' +
      fxEffectPct.toFixed(2) +
      ' puntos frente a ' +
      assetEffectPct.toFixed(2) +
      ' del activo. Estas corriendo una posicion cambiaria, la hayas buscado o no.'
  } else {
    summary =
      'El activo explica la mayor parte de este resultado: aporto ' +
      assetEffectPct.toFixed(2) +
      ' puntos frente a ' +
      fxEffectPct.toFixed(2) +
      ' del tipo de cambio.'
  }

  return { assetEffectPct, fxEffectPct, interactionPct, totalPct, summary }
}

export type CurrencyExposure = {
  buckets: ExposureBucket[]
  /** Share of the book priced in the base currency. */
  basePct: number
  /** Share priced in anything else, and therefore exposed to a rate. */
  foreignPct: number
  summary: string
}

export function currencyExposure(
  holdings: ExposureHolding[],
  baseCurrency: string,
): CurrencyExposure {
  const base = (baseCurrency ?? '').toUpperCase()
  const { buckets } = bucketise(holdings, (h) => (h.currency ?? UNKNOWN).toUpperCase())

  const basePct = buckets.find((b) => b.name === base)?.weightPct ?? 0
  const foreignPct = buckets
    .filter((b) => b.name !== base)
    .reduce((sum, b) => sum + b.weightPct, 0)

  const summary =
    buckets.length === 0
      ? 'No hay posiciones para medir exposicion cambiaria.'
      : foreignPct === 0
        ? 'Todo el portafolio esta denominado en ' +
          base +
          ', asi que no corres riesgo cambiario: no hay ninguna posicion cuyo valor dependa de un tipo de cambio.'
        : foreignPct.toFixed(0) +
          '% del portafolio esta denominado en otra moneda. Ese porcentaje se mueve con el tipo de ' +
          'cambio ademas de con el activo, y las dos cosas pueden ir en direcciones opuestas.'

  return { buckets, basePct, foreignPct, summary }
}
