import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { withCache } from '@/lib/cache/with-cache'
import { apiHandler } from '@/lib/api/handler'
import { SNAPSHOT_VALUATION_VERSION } from '@/lib/services/snapshots'
import { dailyMovers } from '@/lib/services/discover'

async function getHandler() {
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
      .select('portfolio_id, total_value, total_cost')
      .eq('snapshot_date', today)
      .gte('valuation_version', SNAPSHOT_VALUATION_VERSION)

    const { data: yesterdaySnaps } = await supabase
      .from('portfolio_snapshots')
      .select('portfolio_id, total_value, total_cost')
      .eq('snapshot_date', yesterdayStr)
      .gte('valuation_version', SNAPSHOT_VALUATION_VERSION)

    if (!todaySnaps || !yesterdaySnaps) return { winners: [], losers: [] }

    // Get public portfolio IDs
    const { data: publicPortfolios } = await supabase
      .from('portfolios')
      .select('id, name')
      .eq('visibility', 'public')
      .is('deleted_at', null)

    const names = Object.fromEntries((publicPortfolios ?? []).map((p) => [p.id as string, p.name as string]))
    return dailyMovers(todaySnaps, yesterdaySnaps, names)
  })

  return success(data)
}

export const GET = apiHandler(getHandler)
