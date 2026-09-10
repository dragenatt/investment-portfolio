import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { getHistory } from '@/lib/services/market'
import { computeTechnicalSignal } from '@/lib/services/signal'
import { adjustSeriesBySymbol } from '@/lib/services/corporate-actions'
import { backtestSignal, type Bar, type SignalFn } from '@/lib/services/backtest'
import { getRiskFreeRate } from '@/lib/services/risk-free-rate'
import { withCache } from '@/lib/cache/with-cache'
import { apiHandler } from '@/lib/api/handler'

/**
 * The existing technical signal, wrapped so the backtester can drive it.
 *
 * computeTechnicalSignal reports on the LAST bar of whatever it is given, which
 * is exactly the contract the backtester needs: hand it a prefix of the series
 * and it can only speak about the end of that prefix.
 */
const technicalSignal: SignalFn = (closesToDate) => computeTechnicalSignal(closesToDate).action

/**
 * Walk the technical signal through an asset's history and compare it to simply
 * holding the asset.
 *
 * Buy-and-hold is the number that matters. A signal that returns 12% while the
 * asset returned 30% is not a good signal, and without the comparison it looks
 * like one.
 */
async function getHandler(
  req: Request,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const { symbol } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const url = new URL(req.url)
  const range = url.searchParams.get('range') ?? '5y'
  const costPct = Number(url.searchParams.get('cost') ?? 0.1)
  const upper = symbol.toUpperCase()

  const data = await withCache(
    `market:backtest:${upper}:${range}:${costPct}`,
    6 * 3600, // the verdict only moves with daily closes
    async () => {
      const history = (await getHistory(symbol, range)) as Array<{
        date: string
        close: number | null
      }>

      // Split-adjusted, or a 4:1 split reads as a -75% day and the signal
      // reacts to a price move that never happened.
      const adjusted = adjustSeriesBySymbol(
        (history ?? [])
          .filter((h) => h.close != null && Number.isFinite(h.close))
          .map((h) => ({ symbol: upper, date: String(h.date).slice(0, 10), close: h.close as number })),
      )
      const bars: Bar[] = adjusted.map((r) => ({ date: r.date, close: r.close }))

      if (bars.length < 260) {
        return {
          message: 'Not enough history to backtest',
          observations: bars.length,
        }
      }

      // The signal needs 200 closes before it can read its longest moving
      // average, so nothing before bar 200 is a real decision.
      const riskFree = await getRiskFreeRate('USD')
      const result = backtestSignal(bars, technicalSignal, {
        warmupBars: 200,
        initialCapital: 10000,
        costPct: Number.isFinite(costPct) ? costPct : 0.1,
        riskFreeRate: riskFree.rate,
      })

      if (!result) return { message: 'Not enough history to backtest', observations: bars.length }

      return {
        symbol: upper,
        range,
        observations: bars.length,
        from: bars[0].date,
        to: bars[bars.length - 1].date,
        cost_pct: costPct,
        risk_free_rate: { annual_pct: riskFree.rate * 100, source: riskFree.source },
        ...result,
      }
    }
  )

  return success(data)
}

export const GET = apiHandler(getHandler)
