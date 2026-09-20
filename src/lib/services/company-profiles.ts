// Sector and country for the symbols people actually hold.
//
// company_data is read by five screens — the allocation breakdown, the
// exposure map, attribution, the optimiser's sector caps and the
// concentration notification — and it was never written by anything. Four rows
// existed in production, seeded by hand: AAPL, GOOGL, NVDA and VOO. The other
// twenty-six held symbols fell through to "Unknown", so "Por Sector" described
// four positions and the geography chart described one country.
//
// Two sources fill it, in this order:
//
//   1. A written-down table, for instruments no company profile covers. An
//      index is not a company and an ETF's sector is its mandate, not an
//      industry; a provider that answers `{}` for them is not wrong.
//   2. Finnhub's /stock/profile2, for everything else. Free tier, already the
//      fallback quote provider, and it answers with the industry and the
//      country of the listing.
//
// A symbol neither covers is left alone rather than guessed at. "Unknown" on
// the screen is the truth about a symbol nobody can classify — several of the
// ones in production are not real tickers.

import type { SupabaseClient } from '@supabase/supabase-js'
import { getCompanyProfile } from './finnhub'

export type CompanyProfile = {
  symbol: string
  name: string | null
  sector: string | null
  hq: string | null
  marketCap: number | null
}

/** How long a stored profile is trusted. Sectors do not move. */
export const PROFILE_TTL_DAYS = 30

/**
 * Instruments that have no company behind them, written down with their
 * source. The sector is the one the screens already use for a fund ('ETF',
 * as VOO's hand-seeded row has); the country is where the fund or index is
 * domiciled, which is what the geography chart is asking.
 *
 * Source: each fund's own factsheet, read 2026-09-20. Index domiciles are the
 * exchange the index belongs to.
 */
const KNOWN_FUNDS: Record<string, { name: string; sector: string; hq: string }> = {
  // ─── Index funds and broad-market ETFs ──────────────────────────────────
  VOO: { name: 'Vanguard S&P 500 ETF', sector: 'ETF', hq: 'US' },
  QQQ: { name: 'Invesco QQQ Trust', sector: 'ETF', hq: 'US' },
  IEMG: { name: 'iShares Core MSCI Emerging Markets ETF', sector: 'ETF', hq: 'US' },
  VWO: { name: 'Vanguard FTSE Emerging Markets ETF', sector: 'ETF', hq: 'US' },
  EMXC: { name: 'iShares MSCI Emerging Markets ex China ETF', sector: 'ETF', hq: 'US' },
  FRDM: { name: 'Freedom 100 Emerging Markets ETF', sector: 'ETF', hq: 'US' },
  // Sector and commodity funds: the mandate is the useful label, not "ETF".
  VNQ: { name: 'Vanguard Real Estate ETF', sector: 'Real Estate', hq: 'US' },
  GLD: { name: 'SPDR Gold Shares', sector: 'Commodities', hq: 'US' },

  // ─── Indices ────────────────────────────────────────────────────────────
  '^GSPC': { name: 'S&P 500', sector: 'Index', hq: 'US' },
  '^IXIC': { name: 'NASDAQ Composite', sector: 'Index', hq: 'US' },
  '^DJI': { name: 'Dow Jones Industrial Average', sector: 'Index', hq: 'US' },
  '^N225': { name: 'Nikkei 225', sector: 'Index', hq: 'JP' },
  '^FTSE': { name: 'FTSE 100', sector: 'Index', hq: 'GB' },
  '^GDAXI': { name: 'DAX', sector: 'Index', hq: 'DE' },
  '^MXX': { name: 'IPC (BMV)', sector: 'Index', hq: 'MX' },
}

/**
 * A Mexican listing carries the .MX suffix and a Brazilian one .SA. The
 * company behind FEMSAUBD.MX is Mexican whatever a US provider says, and
 * assuming the United States because most symbols are American is exactly the
 * error the geography chart would repeat.
 */
const SUFFIX_COUNTRIES: Record<string, string> = {
  '.MX': 'MX',
  '.SA': 'BR',
  '.TO': 'CA',
  '.L': 'GB',
  '.PA': 'FR',
  '.DE': 'DE',
  '.T': 'JP',
}

function countryFromSuffix(symbol: string): string | null {
  for (const [suffix, country] of Object.entries(SUFFIX_COUNTRIES)) {
    if (symbol.toUpperCase().endsWith(suffix)) return country
  }
  return null
}

/** The written-down profile for an instrument that is not a company. */
export function knownFundProfile(symbol: string): CompanyProfile | null {
  const entry = KNOWN_FUNDS[symbol.toUpperCase()]
  if (!entry) return null
  return { symbol: symbol.toUpperCase(), name: entry.name, sector: entry.sector, hq: entry.hq, marketCap: null }
}

/**
 * The profile for one symbol, or null when nothing can say what it is.
 *
 * The suffix has the last word on the country: a provider that reports a
 * Mexican listing as US would put FEMSAUBD.MX in the wrong place on the map,
 * and the suffix is not a guess.
 */
export async function resolveProfile(symbol: string): Promise<CompanyProfile | null> {
  const known = knownFundProfile(symbol)
  if (known) return known

  const fromProvider = await getCompanyProfile(symbol).catch(() => null)
  const suffixCountry = countryFromSuffix(symbol)

  if (!fromProvider) {
    return suffixCountry
      ? { symbol: symbol.toUpperCase(), name: null, sector: null, hq: suffixCountry, marketCap: null }
      : null
  }

  return {
    symbol: fromProvider.symbol,
    name: fromProvider.name,
    sector: fromProvider.sector,
    hq: suffixCountry ?? fromProvider.country,
    marketCap: fromProvider.marketCap,
  }
}

/**
 * Fill in the profiles for a set of symbols, skipping the ones already stored
 * and still fresh. Returns how many were written.
 *
 * Existing rows are updated field by field rather than replaced: this table
 * also holds fundamentals (P/E, 52-week range, analyst targets) that this
 * function knows nothing about, and an upsert of the whole row would erase
 * them.
 */
export async function refreshCompanyProfiles(
  admin: SupabaseClient,
  symbols: string[],
  now: number = Date.now(),
): Promise<number> {
  const wanted = [...new Set(symbols.map((s) => s.toUpperCase()))]
  if (wanted.length === 0) return 0

  const { data: existing } = await admin
    .from('company_data')
    .select('symbol, sector, hq, expires_at')
    .in('symbol', wanted)

  const stale = new Set(wanted)
  for (const row of existing ?? []) {
    const hasProfile = Boolean(row.sector) && Boolean(row.hq)
    const current = row.expires_at ? Date.parse(row.expires_at) > now : false
    if (hasProfile && current) stale.delete(row.symbol)
  }
  if (stale.size === 0) return 0

  const expiresAt = new Date(now + PROFILE_TTL_DAYS * 86_400_000).toISOString()
  let written = 0

  for (const symbol of stale) {
    const profile = await resolveProfile(symbol)
    if (!profile || (!profile.sector && !profile.hq)) continue

    const row: Record<string, unknown> = {
      symbol: profile.symbol,
      fetched_at: new Date(now).toISOString(),
      expires_at: expiresAt,
    }
    if (profile.name) row.name = profile.name
    if (profile.sector) row.sector = profile.sector
    if (profile.hq) row.hq = profile.hq
    if (profile.marketCap) row.market_cap = profile.marketCap

    const { error } = await admin.from('company_data').upsert(row, { onConflict: 'symbol' })
    if (error) {
      console.warn(`[profiles] ${symbol}: ${error.message}`)
      continue
    }
    written++
  }

  return written
}

/**
 * The profiles for every symbol anybody holds. The nightly job's entry point:
 * a sector is only useful for a position somebody actually has, and a profile
 * fetched once a month is not worth a request per page view.
 */
export async function refreshHeldCompanyProfiles(
  admin: SupabaseClient,
  now: number = Date.now(),
): Promise<number> {
  const { data } = await admin.from('positions').select('symbol').gt('quantity', 0)
  return refreshCompanyProfiles(admin, (data ?? []).map((row) => String(row.symbol)), now)
}
