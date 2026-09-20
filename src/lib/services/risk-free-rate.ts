// Risk-free rate per currency — the Rf that Sharpe, Sortino and Jensen's alpha
// subtract before judging a portfolio.
//
// A single hardcoded rate cannot serve three currencies: a Mexican portfolio
// measured against a US T-Bill yield looks far better than it is, and a dollar
// portfolio measured against CETES looks far worse. Each currency therefore has
// its own chain — an official publisher first, an operator-configured value
// next, and a documented constant last — and every result says which link
// answered so the interface can be honest about it.
//
// Rates are annual and expressed as fractions (0.0425 = 4.25%), matching
// analytics.ts. See docs/FINANCIAL_ASSUMPTIONS.md.

import { withCache } from '@/lib/cache/with-cache'
import { CircuitBreaker, isCircuitOpenError } from './resilience'

export type RiskFreeCurrency = 'MXN' | 'USD' | 'EUR'

export type RateReading = { rate: number; asOf: string | null }

export type RateProvider = {
  id: string
  load: () => Promise<RateReading | null>
}

export type RiskFreeRate = {
  currency: RiskFreeCurrency
  /** Annual rate as a fraction — 0.0425 is 4.25%. */
  rate: number
  /** Which link of the chain answered: a provider id, 'env', or the default's id. */
  source: string
  /** Date the published observation refers to, ISO. Null when no publisher answered. */
  asOf: string | null
  /** True when the rate came from configuration or the documented default. */
  isFallback: boolean
}

const SUPPORTED: RiskFreeCurrency[] = ['MXN', 'USD', 'EUR']

const CACHE_TTL_SECONDS = 24 * 60 * 60
const PROVIDER_TIMEOUT_MS = 4000

// Plausible band for an annual short-term sovereign rate. The euro area held
// policy rates below zero from 2014 to 2022, so a small negative rate is real;
// anything past 50% is a parsing accident rather than a rate.
const MIN_RATE = -0.05
const MAX_RATE = 0.5

/**
 * Last-resort constants, used only when no publisher answers and no environment
 * value is set. Each is a real observation captured on 2026-09-08 from the same
 * source the matching provider queries, so a stale default is at least a rate
 * that once existed. They do go stale — the isFallback flag exists to say so.
 */
const DEFAULTS: Record<RiskFreeCurrency, { rate: number; source: string }> = {
  // US Treasury, average interest rate on Treasury Bills, 2026-08-31
  USD: { rate: 0.03788, source: 'default:us-treasury-bills-2026-08-31' },
  // ECB, euro short-term rate (STR), 2026-09-07
  EUR: { rate: 0.02188, source: 'default:ecb-estr-2026-09-07' },
  // OECD, Mexico 3-month interbank rate (IR3TIB), 2026-08
  MXN: { rate: 0.0679, source: 'default:oecd-mex-3m-2026-08' },
}

function isPlausible(rate: number): boolean {
  return Number.isFinite(rate) && rate >= MIN_RATE && rate <= MAX_RATE
}

/**
 * A published percentage (3.788) as a fraction (0.03788), or null when the value
 * is missing, unparseable or outside the plausible band. Reading the quotient at
 * 12 significant digits drops the binary noise of dividing by 100.
 */
function percentToFraction(value: unknown): number | null {
  const percent =
    typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN
  if (!Number.isFinite(percent)) return null
  const rate = Number((percent / 100).toPrecision(12))
  return isPlausible(rate) ? rate : null
}

// ─── Payload parsers ────────────────────────────────────────────────────────
// Kept pure and exported so the shape of each publisher's response is pinned by
// tests against captured live payloads (tests/fixtures).

type SdmxStructure = {
  dimensions?: { observation?: Array<{ id?: string; values?: Array<{ id?: string }> }> }
}

function sdmxTimePeriod(structure: SdmxStructure | undefined): string | null {
  const dimension = structure?.dimensions?.observation?.find((d) => d.id === 'TIME_PERIOD')
  return dimension?.values?.[0]?.id ?? null
}

/** US Treasury Fiscal Data — average interest rate on Treasury Bills. */
export function parseTreasuryBillsRate(payload: unknown): RateReading | null {
  const rows = (payload as { data?: unknown } | null)?.data
  if (!Array.isArray(rows) || rows.length === 0) return null
  const row = rows[0] as { avg_interest_rate_amt?: unknown; record_date?: unknown }
  const rate = percentToFraction(row?.avg_interest_rate_amt)
  if (rate === null) return null
  return { rate, asOf: typeof row.record_date === 'string' ? row.record_date : null }
}

/** ECB Data Portal — euro short-term rate, SDMX-JSON. */
export function parseEcbEstrRate(payload: unknown): RateReading | null {
  const body = payload as
    | {
        dataSets?: Array<{ series?: Record<string, { observations?: Record<string, unknown[]> }> }>
        structure?: SdmxStructure
      }
    | null
    | undefined
  const series = body?.dataSets?.[0]?.series
  if (!series) return null
  const observations = Object.values(series)[0]?.observations
  const rate = percentToFraction(observations ? Object.values(observations)[0]?.[0] : undefined)
  if (rate === null) return null
  return { rate, asOf: sdmxTimePeriod(body?.structure) }
}

/** OECD SDMX — a country's short-term interest rate; the MXN source needing no token. */
export function parseOecdShortTermRate(payload: unknown): RateReading | null {
  const body = payload as
    | {
        data?: {
          dataSets?: Array<{ observations?: Record<string, unknown[]> }>
          structure?: SdmxStructure
        }
      }
    | null
    | undefined
  const observations = body?.data?.dataSets?.[0]?.observations
  if (!observations) return null
  const rate = percentToFraction(Object.values(observations)[0]?.[0])
  if (rate === null) return null
  return { rate, asOf: sdmxTimePeriod(body?.data?.structure) }
}

/**
 * Banxico SIE — CETES 28 dias (series SF43936). Dates arrive as dd/mm/yyyy and
 * periods without a quote arrive as the literal "N/E", which parses to null.
 */
export function parseBanxicoCetesRate(payload: unknown): RateReading | null {
  const datos = (
    payload as {
      bmx?: { series?: Array<{ datos?: Array<{ fecha?: string; dato?: string }> }> }
    } | null
  )?.bmx?.series?.[0]?.datos
  if (!Array.isArray(datos) || datos.length === 0) return null
  const latest = datos[datos.length - 1]
  const rate = percentToFraction(latest?.dato)
  if (rate === null) return null
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(latest?.fecha ?? '')
  return { rate, asOf: match ? `${match[3]}-${match[2]}-${match[1]}` : null }
}

// ─── Resolution ─────────────────────────────────────────────────────────────

/**
 * Walk the chain for one currency: each provider in turn, then the configured
 * environment rate, then the documented default. A provider that throws, answers
 * nothing, or answers something implausible is skipped rather than propagated —
 * a risk metric should degrade to a labelled fallback, not fail outright.
 */
export async function resolveRiskFreeRate(
  currency: RiskFreeCurrency,
  providers: RateProvider[],
  envRate: number | null,
  fallback: { rate: number; source: string },
): Promise<RiskFreeRate> {
  for (const provider of providers) {
    try {
      const reading = await provider.load()
      if (reading && isPlausible(reading.rate)) {
        return {
          currency,
          rate: reading.rate,
          source: provider.id,
          asOf: reading.asOf,
          isFallback: false,
        }
      }
    } catch (err) {
      console.error(`Risk-free rate provider ${provider.id} failed for ${currency}:`, err)
    }
  }

  if (envRate !== null && isPlausible(envRate)) {
    return { currency, rate: envRate, source: 'env', asOf: null, isFallback: true }
  }

  return { currency, rate: fallback.rate, source: fallback.source, asOf: null, isFallback: true }
}

// ─── Live providers ─────────────────────────────────────────────────────────

async function fetchJson(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  const response = await fetch(url, {
    headers: { Accept: 'application/json', ...headers },
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
  return response.json()
}

const TREASURY_URL =
  'https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/avg_interest_rates' +
  '?fields=record_date,security_desc,avg_interest_rate_amt' +
  '&filter=security_desc:eq:Treasury%20Bills&sort=-record_date&page[size]=1'

const ECB_ESTR_URL =
  'https://data-api.ecb.europa.eu/service/data/EST/B.EU000A2X2A25.WT?lastNObservations=1&format=jsondata'

const OECD_MEX_3M_URL =
  'https://sdmx.oecd.org/public/rest/data/OECD.SDD.STES,DSD_STES@DF_FINMARK,4.0/' +
  'MEX.M.IR3TIB......?lastNObservations=1&dimensionAtObservation=AllDimensions'

const BANXICO_CETES_28_URL =
  'https://www.banxico.org.mx/SieAPIRest/service/v1/series/SF43936/datos/oportuno'

// ─── Breakers ───────────────────────────────────────────────────────────────
//
// The OECD endpoint answered 500 to production 99 times between 2026-09-16 and
// 2026-09-20, on ten different routes, while answering 200 from everywhere
// else — so the URL is right and the outage is theirs. Each of those failures
// cost a request up to PROVIDER_TIMEOUT_MS of waiting before the chain could
// fall through to the documented default, and wrote one more identical line to
// the log.
//
// The market providers have had breakers since the beginning; the rate
// providers had none. The window is far longer than market.ts uses (15 minutes
// against 30 seconds) because these are daily- and monthly-published figures:
// a publisher that has been down for an hour will not be back in half a
// minute, and nothing is lost by not asking, since the answer only changes
// once a day.

const BREAKER_RESET_MS = 15 * 60_000
const BREAKER_FAILURE_THRESHOLD = 3

const breakers = new Map<string, CircuitBreaker>()

function breakerFor(id: string): CircuitBreaker {
  const existing = breakers.get(id)
  if (existing) return existing
  const breaker = new CircuitBreaker({
    name: `rate:${id}`,
    failureThreshold: BREAKER_FAILURE_THRESHOLD,
    resetTimeoutMs: BREAKER_RESET_MS,
    successThreshold: 1,
  })
  breakers.set(id, breaker)
  return breaker
}

/**
 * The same provider, with a breaker in front of it. A refused call answers
 * null — "nothing from this one right now" — which is what the chain already
 * knows how to walk past. It is not reported as a failure, because no call was
 * made; the breaker said so once when it opened.
 */
function guarded(provider: RateProvider): RateProvider {
  const breaker = breakerFor(provider.id)
  return {
    id: provider.id,
    load: async () => {
      try {
        return await breaker.execute(() => provider.load())
      } catch (err) {
        if (isCircuitOpenError(err)) return null
        throw err
      }
    },
  }
}

/** Forget every breaker's state (useful for testing). */
export function resetRateBreakers() {
  breakers.clear()
}

function banxicoProvider(): RateProvider | null {
  const token = process.env.BANXICO_API_TOKEN
  if (!token) return null
  return {
    id: 'banxico:cetes-28',
    load: async () =>
      parseBanxicoCetesRate(await fetchJson(BANXICO_CETES_28_URL, { 'Bmx-Token': token })),
  }
}

function providersFor(currency: RiskFreeCurrency): RateProvider[] {
  return liveProvidersFor(currency).map(guarded)
}

function liveProvidersFor(currency: RiskFreeCurrency): RateProvider[] {
  switch (currency) {
    case 'USD':
      return [
        {
          id: 'us-treasury:bills',
          load: async () => parseTreasuryBillsRate(await fetchJson(TREASURY_URL)),
        },
      ]
    case 'EUR':
      return [{ id: 'ecb:estr', load: async () => parseEcbEstrRate(await fetchJson(ECB_ESTR_URL)) }]
    case 'MXN': {
      // CETES is the rate Mexican investors actually price against, but Banxico
      // requires a free token. Without one, OECD publishes the same country's
      // 3-month interbank rate with no credentials.
      const oecd: RateProvider = {
        id: 'oecd:mex-3m-interbank',
        load: async () =>
          parseOecdShortTermRate(
            await fetchJson(OECD_MEX_3M_URL, {
              Accept: 'application/vnd.sdmx.data+json;version=1.0',
            }),
          ),
      }
      const banxico = banxicoProvider()
      return banxico ? [banxico, oecd] : [oecd]
    }
  }
}

/**
 * RISK_FREE_RATE_MXN and friends hold an annual percentage the way the
 * publishers write it — RISK_FREE_RATE_MXN=7.45 means 7.45%.
 */
function envRateFor(currency: RiskFreeCurrency): number | null {
  const raw = process.env[`RISK_FREE_RATE_${currency}`]
  if (!raw) return null
  const rate = percentToFraction(raw)
  if (rate === null) {
    console.error(`RISK_FREE_RATE_${currency} is not a usable annual percentage: ${raw}`)
  }
  return rate
}

/** Currencies outside the supported set fall back to USD, the default reserve rate. */
export function normaliseRiskFreeCurrency(currency: string): RiskFreeCurrency {
  const upper = (currency ?? '').toUpperCase() as RiskFreeCurrency
  return SUPPORTED.includes(upper) ? upper : 'USD'
}

/**
 * The annual risk-free rate for a currency, cached for 24 hours. These are
 * daily- or monthly-published figures, so a shorter window would only spend the
 * publishers' rate limits.
 */
export async function getRiskFreeRate(currency: string): Promise<RiskFreeRate> {
  const normalised = normaliseRiskFreeCurrency(currency)
  return withCache(`risk-free-rate:${normalised}`, CACHE_TTL_SECONDS, () =>
    resolveRiskFreeRate(
      normalised,
      providersFor(normalised),
      envRateFor(normalised),
      DEFAULTS[normalised],
    ),
  )
}
