import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { getHistory } from '@/lib/services/market'
import { withCache } from '@/lib/cache/with-cache'
import { apiHandler } from '@/lib/api/handler'
import { getRiskFreeRate } from '@/lib/services/risk-free-rate'
import {
  multiHorizonReturns,
  mergeHorizons,
  assetRiskMetrics,
} from '@/lib/services/asset-metrics'
import type { PriceBar } from '@/lib/services/stress-testing'

/** What the asset page's risk section is measured against. */
const BENCHMARK = 'SPY'

/**
 * Performance across every standard window, plus the risk profile, for one asset.
 *
 * ── Two series, because one cannot do both jobs ─────────────────────────────
 *
 * The provider returns DAILY bars only for ranges up to six months; anything
 * reaching a year or more comes back weekly or monthly. The first version of
 * this route asked for five years and treated what came back as daily, which
 * rendered the S&P 500 at 70.7% annual volatility, a Sharpe of 3.34, a VaR
 * labelled "1 day" that was a month, and n/d for every horizon from 1M up.
 * Annualising monthly returns with sqrt(252) inflates them by sqrt(21).
 *
 * So: the six-month DAILY series carries the risk metrics and the short
 * horizons, and the five-year MONTHLY series carries the long ones. Each is
 * used only for what it can actually answer, and mergeHorizons prefers the
 * finer of the two wherever both can.
 *
 * As in the stress route, this reads the provider directly and does not write
 * back: storing monthly bars in a table everything else reads as daily would
 * turn a month's move into a "daily" return across the whole app.
 */
async function getHandler(_req: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const upper = symbol.toUpperCase()

  const data = await withCache(
    // v2: the v1 payload annualised monthly bars as daily. Bumping the key
    // retires those cached wrong numbers instead of serving them for an hour.
    `market:stats:v4:${upper}`,
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

      const [ownDaily, benchmarkDaily, ownLong] = await Promise.all([
        getHistory(upper, '6mo').then(toBars).catch(() => [] as PriceBar[]),
        getHistory(BENCHMARK, '6mo').then(toBars).catch(() => [] as PriceBar[]),
        getHistory(upper, '5y').then(toBars).catch(() => [] as PriceBar[]),
      ])

      if (ownDaily.length < 2 && ownLong.length < 2) {
        return { symbol: upper, message: 'No hay historial suficiente para este símbolo.' }
      }

      const riskFree = await getRiskFreeRate('USD')

      // Risk comes off the daily series. Falling back to the long one is better
      // than nothing, and assetRiskMetrics now annualises by the cadence it
      // detects, so the numbers stay honest either way — the VaR label travels
      // with them.
      const risk =
        assetRiskMetrics(ownDaily, benchmarkDaily, riskFree.rate) ??
        assetRiskMetrics(ownLong, [], riskFree.rate)

      const performance = mergeHorizons(
        multiHorizonReturns(ownDaily),
        ownLong.length >= 2 ? multiHorizonReturns(ownLong) : null,
      )

      const covered = ownLong.length >= 2 ? ownLong : ownDaily

      return {
        symbol: upper,
        observations: covered.length,
        from_date: covered[0].date,
        to_date: covered[covered.length - 1].date,
        benchmark_symbol: BENCHMARK,
        risk_free_rate: {
          currency: riskFree.currency,
          annual_pct: Math.round(riskFree.rate * 10000) / 100,
          source: riskFree.source,
          is_fallback: riskFree.isFallback,
        },
        performance,
        // Null rather than a stub when the history is too short to measure risk
        // from. A volatility computed off eight bars is not a volatility.
        risk,
      }
    }
  )

  return success(data)
}

export const GET = apiHandler(getHandler)
