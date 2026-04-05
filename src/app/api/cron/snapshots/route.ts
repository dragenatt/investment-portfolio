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
import {
  runNightlySnapshots,
  refreshLeaderboard,
  createAdminSupabase,
  startCronRun,
  finishCronRun,
} from '@/lib/services/snapshots'
import { fetchAndStoreBenchmarks } from '@/lib/services/benchmarks'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminSupabase()
  const startTime = Date.now()
  const runId = await startCronRun(supabase, 'nightly_snapshots')

  try {
    // 1. Snapshots
    const snapshotResult = await runNightlySnapshots()

    // 2. Archive leaderboard to history BEFORE refreshing
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

    // 3. Refresh leaderboard
    await refreshLeaderboard()

    // 4. Fetch benchmark prices
    const benchmarksStored = await fetchAndStoreBenchmarks(supabase)

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
      leaderboard: 'refreshed',
      benchmarks: { stored: benchmarksStored },
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
