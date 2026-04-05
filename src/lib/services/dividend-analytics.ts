import { type SupabaseClient } from '@supabase/supabase-js'

export async function getIncomeAnalytics(supabase: SupabaseClient, portfolioId: string) {
  const now = new Date()
  const yearStart = `${now.getFullYear()}-01-01`
  const monthStart = `${now.toISOString().slice(0, 7)}-01`

  // Get dividend transactions
  const { data: dividends } = await supabase
    .from('transactions')
    .select('quantity, price, executed_at, position:positions!inner(portfolio_id, symbol)')
    .eq('type', 'dividend')
    .eq('position.portfolio_id', portfolioId)
    .order('executed_at', { ascending: true })

  const allDivs = dividends ?? []

  // MTD, YTD, all-time
  let mtd = 0, ytd = 0, allTime = 0
  const monthlyHistory: Record<string, number> = {}

  for (const d of allDivs) {
    const amount = (d.quantity as number) * (d.price as number)
    const date = d.executed_at as string
    allTime += amount
    if (date >= yearStart) ytd += amount
    if (date >= monthStart) mtd += amount

    const month = date.slice(0, 7)
    monthlyHistory[month] = (monthlyHistory[month] || 0) + amount
  }

  return {
    summary: { mtd, ytd, all_time: allTime },
    monthly_history: Object.entries(monthlyHistory)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, amount]) => ({ month, amount })),
  }
}
