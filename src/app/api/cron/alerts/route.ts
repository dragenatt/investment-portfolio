import { NextResponse } from 'next/server'
import { cronRequestAuthorized } from '@/lib/api/cron-auth'
import { createAdminSupabase, startCronRun, finishCronRun } from '@/lib/services/snapshots'
import { runPriceAlerts } from '@/lib/services/portfolio-notifications'
import { apiHandler } from '@/lib/api/handler'

/**
 * Price alerts, evaluated every five minutes.
 *
 * Vercel's free plan runs scheduled jobs once a day, so this route is called
 * by the Cloudflare worker in worker/ on its own five-minute schedule, with the
 * same `Authorization: Bearer <CRON_SECRET>` the Vercel crons send. Fails
 * closed like every cron route (cron-auth.ts).
 *
 * The work is small: one read of the active alerts, one quote request per
 * twenty of their symbols, and a write only for an alert that fires.
 *
 * Each run is recorded in cron_runs as 'price_alerts', which is how anyone can
 * see the schedule is alive; rows older than a week are pruned here, since a
 * five-minute job writes 288 a day.
 */

export const runtime = 'nodejs'
export const maxDuration = 60

const JOB = 'price_alerts'
const KEEP_RUNS_MS = 7 * 24 * 60 * 60 * 1000

async function handler(req: Request) {
  if (!cronRequestAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminSupabase()
  const started = Date.now()
  const runId = await startCronRun(supabase, JOB)

  try {
    const result = await runPriceAlerts(supabase)
    await finishCronRun(supabase, runId, { processed: result.fired, errors: 0 })
    return NextResponse.json({ ok: true, ...result, duration_ms: Date.now() - started })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    await finishCronRun(supabase, runId, { processed: 0, errors: 1, errorDetails: { message } })
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  } finally {
    if (runId) await supabase.from('cron_runs').update({ duration_ms: Date.now() - started }).eq('id', runId)
    await supabase
      .from('cron_runs')
      .delete()
      .eq('job_name', JOB)
      .lt('started_at', new Date(started - KEEP_RUNS_MS).toISOString())
  }
}

export const GET = apiHandler(handler)
export const POST = apiHandler(handler)
