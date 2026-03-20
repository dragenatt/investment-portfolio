import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { calculateVolatility, calculateSharpeRatio, calculateMaxDrawdown, calculateDailyReturns } from '@/lib/services/analytics'

export async function GET(_req: Request, { params }: { params: Promise<{ pid: string }> }) {
  const { pid } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  // Get portfolio positions
  const { data: positions } = await supabase
    .from('positions')
    .select('symbol, quantity, avg_cost')
    .eq('portfolio_id', pid)
    .gt('quantity', 0)

  if (!positions || positions.length === 0) {
    return success({ volatility: 0, sharpe: 0, maxDrawdown: 0, message: 'No positions' })
  }

  // Get price history for portfolio value calculation
  const symbols = positions.map(p => p.symbol)
  const { data: history } = await supabase
    .from('price_history')
    .select('symbol, date, close')
    .in('symbol', symbols)
    .order('date', { ascending: true })
    .limit(365)

  if (!history || history.length < 10) {
    return success({ volatility: 0, sharpe: 0, maxDrawdown: 0, message: 'Insufficient price history' })
  }

  // Calculate portfolio value per day
  const dateMap = new Map<string, number>()
  for (const h of history) {
    const pos = positions.find(p => p.symbol === h.symbol)
    if (!pos) continue
    const current = dateMap.get(h.date) || 0
    dateMap.set(h.date, current + pos.quantity * h.close)
  }

  const values = [...dateMap.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(e => e[1])
  const returns = calculateDailyReturns(values)

  // Use CETES 28-day rate as risk-free rate (approx 10% annual in MXN, ~5% USD)
  const riskFreeRate = 0.10

  return success({
    volatility: calculateVolatility(returns) * 100,
    sharpe: calculateSharpeRatio(returns, riskFreeRate),
    maxDrawdown: calculateMaxDrawdown(values),
    dataPoints: values.length,
  })
}
