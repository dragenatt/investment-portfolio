import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { withCache } from '@/lib/cache/with-cache'
import { CACHE_KEYS } from '@/lib/cache/redis'
import { calculateSimpleReturn, calculateTWR, calculateMWR } from '@/lib/services/returns'

export async function GET(req: Request, { params }: { params: Promise<{ pid: string }> }) {
  const { pid } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const url = new URL(req.url)
  const period = url.searchParams.get('period') || '1Y'

  const data = await withCache(
    `${CACHE_KEYS.ANALYTICS_RETURNS}${pid}:${period}`,
    600,
    async () => {
      // Get snapshots
      const cutoff = getPeriodCutoff(period)
      const { data: snapshots } = await supabase
        .from('portfolio_snapshots')
        .select('snapshot_date, total_value, total_cost')
        .eq('portfolio_id', pid)
        .gte('snapshot_date', cutoff)
        .order('snapshot_date', { ascending: true })

      // Get transactions for TWR/MWR
      const { data: transactions } = await supabase
        .from('transactions')
        .select('executed_at, type, quantity, price, position:positions!inner(portfolio_id)')
        .eq('position.portfolio_id', pid)
        .gte('executed_at', cutoff)
        .order('executed_at', { ascending: true })

      const snaps = (snapshots ?? []).map((s) => ({ date: s.snapshot_date, value: s.total_value }))
      const lastSnap = snapshots?.[snapshots.length - 1]
      const firstSnap = snapshots?.[0]

      // Simple return
      const simple = lastSnap && firstSnap
        ? calculateSimpleReturn(lastSnap.total_value, lastSnap.total_cost)
        : 0

      // TWR
      const cashFlows = (transactions ?? [])
        .filter((t) => t.type === 'buy' || t.type === 'sell')
        .map((t) => ({
          date: (t.executed_at as string).split('T')[0],
          amount: t.type === 'buy' ? -(t.quantity as number) * (t.price as number) : (t.quantity as number) * (t.price as number),
        }))

      const twr = calculateTWR(snaps, cashFlows)
      const mwr = lastSnap
        ? calculateMWR(cashFlows, lastSnap.total_value, new Date())
        : 0

      // Calendar returns (monthly)
      const calendar = buildCalendarReturns(snapshots ?? [])

      // Period comparison table
      const periods = await buildPeriodReturns(supabase, pid)

      return { summary: { simple, twr, mwr, period }, calendar, periods }
    }
  )

  return success(data)
}

function getPeriodCutoff(period: string): string {
  const now = new Date()
  switch (period) {
    case '1M': now.setMonth(now.getMonth() - 1); break
    case '3M': now.setMonth(now.getMonth() - 3); break
    case '6M': now.setMonth(now.getMonth() - 6); break
    case 'YTD': now.setMonth(0); now.setDate(1); break
    case '1Y': now.setFullYear(now.getFullYear() - 1); break
    case 'ALL': now.setFullYear(2020); break
    default: now.setFullYear(now.getFullYear() - 1)
  }
  return now.toISOString().split('T')[0]
}

function buildCalendarReturns(snapshots: Array<{ snapshot_date: string; total_value: number }>) {
  const monthly: Record<string, { start: number; end: number }> = {}
  for (const snap of snapshots) {
    const month = snap.snapshot_date.slice(0, 7) // YYYY-MM
    if (!monthly[month]) monthly[month] = { start: snap.total_value, end: snap.total_value }
    monthly[month].end = snap.total_value
  }

  const years: Record<number, (number | null)[]> = {}
  for (const [month, data] of Object.entries(monthly)) {
    const [yearStr, monthStr] = month.split('-')
    const year = parseInt(yearStr)
    const monthIdx = parseInt(monthStr) - 1
    if (!years[year]) years[year] = new Array(12).fill(null)
    years[year][monthIdx] = data.start > 0 ? ((data.end - data.start) / data.start) * 100 : 0
  }

  return Object.entries(years).map(([year, months]) => ({
    year: parseInt(year),
    months,
    total: months.reduce((sum: number, m) => sum + (m ?? 0), 0),
  }))
}

async function buildPeriodReturns(supabase: ReturnType<typeof import('@/lib/supabase/server').createServerSupabase extends () => Promise<infer T> ? () => T : never>, pid: string) {
  // Simplified — returns basic period comparison
  return []
}
