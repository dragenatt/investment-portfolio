/**
 * Daily price baselines — the global "zero point" for daily P&L.
 *
 * A baseline is the previous close (regularMarketPreviousClose) for a symbol on a
 * given trading day. It is computed ONCE PER DAY for ALL users and stored in the
 * `daily_baselines` table (see migration 011), so per-user dashboard loads never
 * re-hit the market APIs for it — the table itself is the global daily cache.
 *
 * Read path:  DB (today's rows) → lazy fetch+upsert any missing symbols.
 * Write path: the /api/cron/baselines job calls refreshBaselines() once daily.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getBatchQuotes } from './market'

export type Baseline = { previousClose: number; open: number | null; currency: string }

// ─── Trading-day key ─────────────────────────────────────────────────────────
// Baselines are a per-trading-day concept anchored to US market time. `en-CA`
// formats as YYYY-MM-DD, which matches a Postgres DATE.
export function tradingDayString(d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d)
}

// ─── Admin client ─────────────────────────────────────────────────────────────
// Baselines are global reference data and the write path needs to bypass RLS, so
// we always use the service role here (this module only ever runs server-side).
function adminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

/**
 * Fetch fresh previous-close baselines for `symbols` and upsert them for `date`.
 * Uses a cache-bypassing quote fetch so the provider's previousClose is not
 * masked by the price cache. Returns only the symbols that resolved.
 */
export async function refreshBaselines(
  symbols: string[],
  supabase: SupabaseClient = adminClient(),
  date: string = tradingDayString(),
): Promise<Record<string, Baseline>> {
  const out: Record<string, Baseline> = {}
  const uniq = [...new Set(symbols)].filter(Boolean)
  if (uniq.length === 0) return out

  // `fresh: true` skips the price cache so previousClose comes straight from a provider.
  const quotes = await getBatchQuotes(uniq, { fresh: true })

  const rows: Array<Record<string, unknown>> = []
  const now = new Date().toISOString()
  for (const sym of uniq) {
    const q = quotes[sym] ?? quotes[sym.toUpperCase()]
    const pc = q?.previousClose
    if (pc != null && pc > 0) {
      const baseline: Baseline = { previousClose: pc, open: null, currency: q?.currency || 'USD' }
      out[sym] = baseline
      rows.push({
        symbol: sym,
        date,
        previous_close: pc,
        open: null,
        currency: baseline.currency,
        source: 'market',
        updated_at: now,
      })
    }
  }

  if (rows.length > 0) {
    await supabase.from('daily_baselines').upsert(rows, { onConflict: 'symbol,date' })
  }
  return out
}

/**
 * Return today's baseline for each requested symbol. Reads pre-computed rows from
 * the DB and lazily fills any that are missing (e.g. a symbol added after the cron
 * ran) — each symbol is fetched at most once per day, globally.
 */
export async function getDailyBaselines(symbols: string[]): Promise<Record<string, Baseline>> {
  const out: Record<string, Baseline> = {}
  const uniq = [...new Set(symbols)].filter(Boolean)
  if (uniq.length === 0) return out

  const date = tradingDayString()
  const supabase = adminClient()

  const { data } = await supabase
    .from('daily_baselines')
    .select('symbol, previous_close, open, currency')
    .eq('date', date)
    .in('symbol', uniq)

  for (const r of data ?? []) {
    out[r.symbol] = { previousClose: r.previous_close, open: r.open, currency: r.currency }
  }

  const missing = uniq.filter((s) => !(s in out))
  if (missing.length > 0) {
    try {
      Object.assign(out, await refreshBaselines(missing, supabase, date))
    } catch {
      // Lazy fill is best-effort — a missing baseline just yields a 0 daily change.
    }
  }

  return out
}
