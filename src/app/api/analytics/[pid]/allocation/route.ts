import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'

export async function GET(_req: Request, { params }: { params: Promise<{ pid: string }> }) {
  const { pid } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const { data: positions } = await supabase
    .from('positions')
    .select('symbol, asset_type, quantity, avg_cost, currency')
    .eq('portfolio_id', pid)
    .gt('quantity', 0)

  if (!positions) return success({ byType: [], bySymbol: [] })

  const byType: Record<string, number> = {}
  const bySymbol: Array<{ symbol: string; value: number; pct: number }> = []
  let total = 0

  for (const pos of positions) {
    const value = pos.quantity * pos.avg_cost
    total += value
    byType[pos.asset_type] = (byType[pos.asset_type] || 0) + value
    bySymbol.push({ symbol: pos.symbol, value, pct: 0 })
  }

  bySymbol.forEach(s => { s.pct = total > 0 ? (s.value / total) * 100 : 0 })

  return success({
    byType: Object.entries(byType).map(([name, value]) => ({ name, value, pct: total > 0 ? (value / total) * 100 : 0 })),
    bySymbol: bySymbol.sort((a, b) => b.value - a.value),
  })
}
