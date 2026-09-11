import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { getHistory } from '@/lib/services/market'
import { withCache } from '@/lib/cache/with-cache'
import { apiHandler } from '@/lib/api/handler'
import { getRiskFreeRate } from '@/lib/services/risk-free-rate'
import { multiHorizonReturns, assetRiskMetrics } from '@/lib/services/asset-metrics'
import type { PriceBar } from '@/lib/services/stress-testing'

/** What the asset page's risk section is measured against. */
const BENCHMARK = 'SPY'

/**
 * Performance across every standard window, plus the risk profile, for one asset.
 *
 * Both halves are computed from the same five-year daily series, so the 1Y
 * return and the 1Y volatility are statements about the same data. Fetching
 * them separately at different ranges is how two numbers on one screen end up
 * describing two different histories.
 *
 * As in the stress route, this reads the provider directly and does not write
 * back: the five-year series comes back at a coarser interval than the daily
 * table expects, and storing it would corrupt the series everything else reads.
 */
async function getHandler(_req: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const upper = symbol.toUpperCase()

  const data = await withCache(
    `market:stats:${upper}`,
    3600,
    async () => {
      const toBars = (history: Array<{ date: string; close: number | null; adjClose?: number | null }>) => {
        const bars: PriceBar[] = []
        for (const point of history) {
          // Adjusted close carries splits and dividends, both of which matter
          // across five years. Raw close is for display, not for returns.
          const close = point.adjClose ?? point.close
          if (close == null || !Number.isFinite(close)) continue
          bars.push({ date: new Date(point.date).toISOString().slice(0, 10), close })
        }
        return bars
      }

      const [own, benchmark] = await Promise.all([
        getHistory(upper, '5y').then(toBars).catch(() => [] as PriceBar[]),
        getHistory(BENCHMARK, '5y').then(toBars).catch(() => [] as PriceBar[]),
      ])

      if (own.length < 2) {
        return { symbol: upper, message: 'No hay historial suficiente para este simbolo.' }
      }

      const riskFree = await getRiskFreeRate('USD')
      const risk = assetRiskMetrics(own, benchmark, riskFree.rate)

      return {
        symbol: upper,
        observations: own.length,
        from_date: own[0].date,
        to_date: own[own.length - 1].date,
        benchmark_symbol: BENCHMARK,
        risk_free_rate: {
          currency: riskFree.currency,
          annual_pct: Math.round(riskFree.rate * 10000) / 100,
          source: riskFree.source,
          is_fallback: riskFree.isFallback,
        },
        performance: multiHorizonReturns(own),
        // Null rather than a stub when the history is too short to measure risk
        // from. A volatility computed off eight bars is not a volatility.
        risk,
      }
    }
  )

  return success(data)
}

export const GET = apiHandler(getHandler)
