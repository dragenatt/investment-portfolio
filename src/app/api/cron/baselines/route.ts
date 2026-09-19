/**
 * Vercel Cron: Daily Price Baselines
 *
 * Runs once per trading day after the US open and stores each symbol's previous
 * close (the "zero point" for daily P&L) in the `daily_baselines` table — ONE row
 * per (symbol, date), shared across ALL users. Per-user dashboard loads then read
 * this instead of re-hitting the market APIs, so we never blow the rate limit.
 *
 * Covers every symbol held in a position or a watchlist. Symbols added afterwards
 * are filled lazily on first read (see services/baselines.ts).
 *
 * Protected by CRON_SECRET. Logs execution to cron_runs for monitoring.
 */

import { NextResponse } from 'next/server'
import { cronRequestAuthorized } from '@/lib/api/cron-auth'
import { createAdminSupabase, startCronRun, finishCronRun } from '@/lib/services/snapshots'
import { refreshBaselines, tradingDayString } from '@/lib/services/baselines'
import { UNIVERSE_SYMBOLS } from '@/lib/data/asset-universe'
import { apiHandler } from '@/lib/api/handler'

export const runtime = 'nodejs'
export const maxDuration = 300

const CHUNK_SIZE = 50

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

async function getHandler(req: Request) {
  // Fails closed: no CRON_SECRET, no access (C6).
  if (!cronRequestAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminSupabase()
  const startTime = Date.now()
  const runId = await startCronRun(supabase, 'daily_baselines')

  try {
    const date = tradingDayString()

    // Every symbol that anyone holds or watches.
    const [{ data: positions }, { data: watched }] = await Promise.all([
      supabase.from('positions').select('symbol').gt('quantity', 0),
      supabase.from('watchlist_items').select('symbol'),
    ])
    const symbols = [
      ...new Set([
        ...(positions ?? []).map((p) => p.symbol as string),
        ...(watched ?? []).map((w) => w.symbol as string),
        ...UNIVERSE_SYMBOLS, // keep the curated ~100 warm for the sector breakdown
      ]),
    ].filter(Boolean)

    // Chunk sequentially so we respect provider rate limits.
    let resolved = 0
    const unresolved: string[] = []
    for (const group of chunk(symbols, CHUNK_SIZE)) {
      const filled = await refreshBaselines(group, supabase, date)
      resolved += Object.keys(filled).length
      unresolved.push(...group.filter((symbol) => !filled[symbol]))
    }

    const duration = Date.now() - startTime
    const errors = symbols.length - resolved
    // Which symbols, not just how many. This run is reported 'partial' every
    // day because a handful of tickers no provider resolves — a BMV listing
    // written without its .MX suffix, an instrument that is not a listing —
    // and with nothing recorded, a real failure would look exactly the same
    // (docs/DATA_QUALITY.md).
    await finishCronRun(supabase, runId, {
      processed: resolved,
      errors: Math.max(0, errors),
      errorDetails: unresolved.length > 0 ? { unresolved_symbols: unresolved.slice(0, 50), unresolved_count: unresolved.length } : null,
    })
    await supabase.from('cron_runs').update({ duration_ms: duration }).eq('id', runId)

    return NextResponse.json({
      success: true,
      date,
      symbols: symbols.length,
      resolved,
      unresolved: unresolved.length,
      unresolved_symbols: unresolved.slice(0, 50),
      duration: `${duration}ms`,
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    const duration = Date.now() - startTime
    await finishCronRun(supabase, runId, {
      processed: 0,
      errors: 1,
      errorDetails: { message: err instanceof Error ? err.message : 'Unknown error' },
    })
    await supabase.from('cron_runs').update({ duration_ms: duration }).eq('id', runId)

    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Unknown error', duration: `${duration}ms` },
      { status: 500 },
    )
  }
}

export const GET = apiHandler(getHandler)
