import { NextResponse } from 'next/server'
import { cronRequestAuthorized } from '@/lib/api/cron-auth'
import { createAdminSupabase } from '@/lib/services/snapshots'
import { apiHandler } from '@/lib/api/handler'

async function getHandler(req: Request) {
  // Fails closed: no CRON_SECRET, no access (C6).
  if (!cronRequestAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminSupabase()

  const { data: runs } = await supabase
    .from('cron_runs')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(14)

  const lastSuccess = runs?.find((r) => r.status === 'success')
  const lastRun = runs?.[0]
  const hoursSinceSuccess = lastSuccess
    ? (Date.now() - new Date(lastSuccess.started_at).getTime()) / (1000 * 60 * 60)
    : Infinity

  return NextResponse.json({
    healthy: hoursSinceSuccess < 26,
    lastRun,
    lastSuccess,
    hoursSinceLastSuccess: Math.round(hoursSinceSuccess * 10) / 10,
    recentRuns: runs,
  })
}

export const GET = apiHandler(getHandler)
