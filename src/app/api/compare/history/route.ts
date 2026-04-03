import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'

function getPeriodDays(period: string): number {
  const map: Record<string, number> = {
    '1W': 7, '1M': 30, '3M': 90, '6M': 180,
    'YTD': Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 1).getTime()) / 86400000),
    '1Y': 365, '3Y': 1095, '5Y': 1825, 'ALL': 10000
  }
  return map[period] || 365
}

export async function GET(req: Request) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const { searchParams } = new URL(req.url)
  const ids = searchParams.get('ids')
  const period = searchParams.get('period') || '1Y'

  if (!ids) return error('ids query parameter is required', 400)

  const portfolioIds = ids.split(',').filter(Boolean).slice(0, 5)
  if (portfolioIds.length === 0) return error('At least one portfolio ID required', 400)

  const periodDays = getPeriodDays(period)
  const startDate = new Date(Date.now() - periodDays * 86400000)
    .toISOString().split('T')[0]

  // Fetch portfolio names
  const { data: portfolios, error: pErr } = await supabase
    .from('portfolios')
    .select('id, name')
    .in('id', portfolioIds)

  if (pErr) return error(pErr.message, 500)

  const portfolioMap = new Map(
    (portfolios || []).map((p: any) => [p.id, p.name])
  )

  // Fetch historical snapshots for all portfolios in the period
  const { data: snapshots, error: snapErr } = await supabase
    .from('portfolio_snapshots')
    .select('portfolio_id, snapshot_date, total_value')
    .in('portfolio_id', portfolioIds)
    .gte('snapshot_date', startDate)
    .order('snapshot_date', { ascending: true })

  if (snapErr) return error(snapErr.message, 500)

  // Group by portfolio and normalize to base 100
  const grouped = new Map<string, Array<{ date: string; value: number }>>()

  for (const snap of (snapshots || [])) {
    if (!grouped.has(snap.portfolio_id)) {
      grouped.set(snap.portfolio_id, [])
    }
    grouped.get(snap.portfolio_id)!.push({
      date: snap.snapshot_date,
      value: snap.total_value
    })
  }

  // Build normalized history
  const history = portfolioIds.map(id => {
    const values = grouped.get(id) || []
    const name = portfolioMap.get(id) || id

    if (values.length === 0) {
      return { portfolioId: id, portfolioName: name, values: [] }
    }

    const startValue = values[0].value
    const normalizedValues = values.map(v => ({
      date: v.date,
      normalizedValue: startValue > 0
        ? Math.round((v.value / startValue) * 10000) / 100 // base 100
        : 100
    }))

    return {
      portfolioId: id,
      portfolioName: name,
      values: normalizedValues
    }
  })

  return success(history)
}
