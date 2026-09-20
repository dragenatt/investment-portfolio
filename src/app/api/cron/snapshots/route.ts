/**
 * Vercel Cron: Nightly Portfolio Snapshots
 *
 * Runs daily at 1:00 AM UTC (after US market close)
 * Computes and stores portfolio metrics for all portfolios,
 * archives leaderboard history, then refreshes the public leaderboard.
 * Also fetches benchmark prices.
 *
 * Protected by CRON_SECRET to prevent unauthorized access.
 * Logs execution to cron_runs table for monitoring.
 */

import { NextResponse } from 'next/server'
import { cronRequestAuthorized } from '@/lib/api/cron-auth'
import {
  runNightlySnapshots,
  refreshLeaderboard,
  createAdminSupabase,
  startCronRun,
  finishCronRun,
} from '@/lib/services/snapshots'
import { fetchAndStoreBenchmarks } from '@/lib/services/benchmarks'
import { refreshExchangeRates } from '@/lib/services/fx-rates'
import { refreshHeldCompanyProfiles } from '@/lib/services/company-profiles'
import { apiHandler } from '@/lib/api/handler'
import { sweepJobs } from '@/lib/jobs/runner'
import { runNightlyNotifications } from '@/lib/services/portfolio-notifications'

export const runtime = 'nodejs'
export const maxDuration = 300

async function getHandler(req: Request) {
  // Fails closed: no CRON_SECRET, no access (C6).
  if (!cronRequestAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminSupabase()
  const startTime = Date.now()
  const runId = await startCronRun(supabase, 'nightly_snapshots')

  try {
    // 1. Snapshots
    const snapshotResult = await runNightlySnapshots()

    // 2. Refresh the leaderboard from today's snapshots, then archive it under
    // today's date (archiving first filed the previous night's ranking under
    // today). Its own try, like the job sweep: a leaderboard problem must not
    // cost the benchmarks below, and it is reported instead of logged away.
    let leaderboard: { portfolios: number } | { error: string }
    try {
      leaderboard = await refreshLeaderboard()

      const { data: currentLeaderboard } = await supabase
        .from('leaderboard_cache')
        .select('category, period, rankings')

      if (currentLeaderboard && currentLeaderboard.length > 0) {
        const today = new Date().toISOString().split('T')[0]
        const historyRows = currentLeaderboard.map((row) => ({
          snapshot_date: today,
          category: row.category,
          period: row.period,
          rankings: row.rankings,
        }))
        await supabase
          .from('leaderboard_history')
          .upsert(historyRows, { onConflict: 'snapshot_date,category,period' })
      }
    } catch (leaderboardError) {
      console.error('[cron] leaderboard refresh failed', leaderboardError)
      leaderboard = { error: leaderboardError instanceof Error ? leaderboardError.message : 'Unknown error' }
    }

    // 3. Exchange rates for every currency anything is quoted in. The browser
    // only ever fetched the pairs for the currencies the interface offers as a
    // display currency, so a holding quoted in yen had no rate at all and its
    // value went into totals unconverted. Its own try: an FX problem must not
    // cost the benchmarks below.
    let exchangeRates: { written: number } | { error: string }
    try {
      exchangeRates = { written: await refreshExchangeRates(supabase) }
    } catch (fxError) {
      console.error('[cron] exchange rates failed', fxError)
      exchangeRates = { error: fxError instanceof Error ? fxError.message : 'Unknown error' }
    }

    // 4. Fetch benchmark prices
    const benchmarksStored = await fetchAndStoreBenchmarks(supabase)

    // 4b. Sector and country for every held symbol. company_data is read by
    // five screens and was written by nothing: four rows existed, seeded by
    // hand, so "Por Sector" described four of thirty positions. Its own try,
    // and it skips anything already stored and fresh.
    let profiles: { written: number } | { error: string }
    try {
      profiles = { written: await refreshHeldCompanyProfiles(supabase) }
    } catch (profileError) {
      console.error('[cron] company profiles failed', profileError)
      profiles = { error: profileError instanceof Error ? profileError.message : 'Unknown error' }
    }

    // 5. Background jobs (C1): fail unfinished jobs nobody has polled for an hour
    // past their deadline, and delete finished ones older than a week. Its own
    // try, so a sweep problem never costs the snapshots above.
    let jobs: { failed: number; deleted: number } | { error: string }
    try {
      jobs = await sweepJobs(supabase)
    } catch (sweepError) {
      jobs = { error: sweepError instanceof Error ? sweepError.message : 'Unknown error' }
    }

    // 6. Notifications (4.5): drawdown and concentration per portfolio,
    // extraordinary moves and stopped histories per holding, and price alerts.
    // Last, and in its own try, so the inbox can never cost the data above.
    let notifications: Awaited<ReturnType<typeof runNightlyNotifications>> | { error: string }
    try {
      notifications = await runNightlyNotifications(supabase)
    } catch (notifyError) {
      console.error('[cron] notifications failed', notifyError)
      notifications = { error: notifyError instanceof Error ? notifyError.message : 'Unknown error' }
    }

    const duration = Date.now() - startTime
    await finishCronRun(supabase, runId, {
      processed: snapshotResult.processed,
      errors: snapshotResult.errors,
    })

    // Update duration_ms properly
    await supabase
      .from('cron_runs')
      .update({ duration_ms: duration })
      .eq('id', runId)

    return NextResponse.json({
      success: true,
      snapshots: { processed: snapshotResult.processed, errors: snapshotResult.errors },
      leaderboard,
      exchangeRates,
      benchmarks: { stored: benchmarksStored },
      profiles,
      jobs,
      notifications,
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
      { status: 500 }
    )
  }
}

export const GET = apiHandler(getHandler)
