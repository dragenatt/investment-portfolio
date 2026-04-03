/**
 * Vercel Cron: Nightly Portfolio Snapshots
 *
 * Runs daily at 1:00 AM UTC (after US market close)
 * Computes and stores portfolio metrics for all portfolios,
 * then refreshes the public leaderboard.
 *
 * Protected by CRON_SECRET to prevent unauthorized access.
 */

import { NextResponse } from 'next/server'
import { runNightlySnapshots, refreshLeaderboard } from '@/lib/services/snapshots'

export const runtime = 'nodejs'
export const maxDuration = 300 // 5 minutes max (Vercel Pro)

export async function GET(req: Request) {
  // Verify cron secret
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const startTime = Date.now()

  try {
    // 1. Run snapshot computation for all portfolios
    const snapshotResult = await runNightlySnapshots()

    // 2. Refresh leaderboard with new data
    await refreshLeaderboard()

    const duration = Date.now() - startTime

    return NextResponse.json({
      success: true,
      snapshots: {
        processed: snapshotResult.processed,
        errors: snapshotResult.errors,
      },
      leaderboard: 'refreshed',
      duration: `${duration}ms`,
      timestamp: new Date().toISOString()
    })
  } catch (err) {
    console.error('[cron/snapshots] Fatal error:', err)
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
        duration: `${Date.now() - startTime}ms`
      },
      { status: 500 }
    )
  }
}
