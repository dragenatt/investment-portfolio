import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { withCache } from '@/lib/cache/with-cache'

export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const data = await withCache('discover:winners', 300, async () => {
    const today = new Date().toISOString().split('T')[0]
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    const yesterdayStr = yesterday.toISOString().split('T')[0]

    // Get today's and yesterday's snapshots for public portfolios
    const { data: todaySnaps } = await supabase
      .from('portfolio_snapshots')
      .select('portfolio_id, total_value, total_return_pct')
      .eq('snapshot_date', today)

    const { data: yesterdaySnaps } = await supabase
      .from('portfolio_snapshots')
      .select('portfolio_id, total_value')
      .eq('snapshot_date', yesterdayStr)

    if (!todaySnaps || !yesterdaySnaps) return { winners: [], losers: [] }

    const yesterdayMap: Record<string, number> = {}
    for (const s of yesterdaySnaps) yesterdayMap[s.portfolio_id] = s.total_value

    // Get public portfolio IDs
    const { data: publicPortfolios } = await supabase
      .from('portfolios')
      .select('id, name, user_id')
      .eq('visibility', 'public')
      .is('deleted_at', null)

    const publicIds = new Set(publicPortfolios?.map((p) => p.id) ?? [])
    const portfolioMap: Record<string, { name: string; user_id: string }> = {}
    for (const p of publicPortfolios ?? []) portfolioMap[p.id] = p

    const changes = todaySnaps
      .filter((s) => publicIds.has(s.portfolio_id) && yesterdayMap[s.portfolio_id])
      .map((s) => {
        const prev = yesterdayMap[s.portfolio_id]
        const change = s.total_value - prev
        const changePct = prev > 0 ? (change / prev) * 100 : 0
        return {
          portfolio_id: s.portfolio_id,
          name: portfolioMap[s.portfolio_id]?.name ?? 'Unknown',
          change: Math.round(change * 100) / 100,
          change_pct: Math.round(changePct * 100) / 100,
          total_value: s.total_value,
        }
      })
      .sort((a, b) => b.change_pct - a.change_pct)

    return {
      winners: changes.slice(0, 5),
      losers: changes.slice(-5).reverse(),
    }
  })

  return success(data)
}
