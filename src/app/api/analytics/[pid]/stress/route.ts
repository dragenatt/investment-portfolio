import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { withCache } from '@/lib/cache/with-cache'
import { apiHandler } from '@/lib/api/handler'
import { getHistory, getBatchQuotes } from '@/lib/services/market'
import { getPortfolioBenchmark } from '@/lib/services/benchmarks'
import { fetchAdjustedPriceHistory, type PriceRow } from '@/lib/services/price-history'
import { calculateDailyReturns, calculateBetaAlpha } from '@/lib/services/analytics'
import {
  HISTORICAL_EPISODES,
  stressTestPortfolio,
  describeStressResult,
  type PriceBar,
} from '@/lib/services/stress-testing'

/**
 * What real crises would have done to this book.
 *
 * ── Why this route calls getHistory directly ───────────────────────────────
 *
 * fetchAdjustedPriceHistory writes whatever it fetches back into price_history,
 * which is exactly right for the daily series the rest of the app reads. It is
 * exactly wrong here: the provider chain only returns MONTHLY bars for ranges
 * long enough to reach 2008, and mixing monthly bars into a table everything
 * else treats as daily would turn a month's move into a "daily" return and
 * corrupt every volatility, VaR and Sharpe figure in the app.
 *
 * So the long series is fetched and used in memory, never stored. The betas
 * below still come through the normal cached path, because those are ordinary
 * one-year daily data.
 */
async function getHandler(_req: Request, { params }: { params: Promise<{ pid: string }> }) {
  const { pid } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const data = await withCache(
    `analytics:stress:${pid}`,
    3600,
    async () => {
      const { data: positions } = await supabase
        .from('positions')
        .select('symbol, quantity, avg_cost')
        .eq('portfolio_id', pid)
        .gt('quantity', 0)

      if (!positions || positions.length === 0) return { message: 'No positions' }

      const symbols = positions.map((p) => p.symbol)
      const benchmarkSymbol = await getPortfolioBenchmark(supabase, pid)

      // Current weights, at live prices where available.
      const priceMap: Record<string, number> = {}
      try {
        const quotes = await getBatchQuotes(symbols)
        for (const [symbol, quote] of Object.entries(quotes)) {
          if (quote.price != null) priceMap[symbol] = quote.price
        }
      } catch {
        // Average cost stands in; the relative weights are what matter here.
      }

      const values = positions.map(
        (p) => p.quantity * (priceMap[p.symbol] ?? p.avg_cost),
      )
      const bookValue = values.reduce((a, b) => a + b, 0)
      if (!(bookValue > 0)) return { message: 'No positions' }

      // Betas from ordinary one-year daily data, for holdings too young to have
      // lived through an episode. Marked as estimates downstream.
      const betas: Record<string, number> = {}
      try {
        const { rows } = await fetchAdjustedPriceHistory(supabase, [
          ...symbols,
          benchmarkSymbol,
        ])
        const closesFor = (symbol: string) =>
          rows
            .filter((r: PriceRow) => r.symbol === symbol)
            .sort((a: PriceRow, b: PriceRow) => a.date.localeCompare(b.date))
            .map((r: PriceRow) => r.close)

        const benchmarkReturns = calculateDailyReturns(closesFor(benchmarkSymbol))
        for (const symbol of symbols) {
          const own = calculateDailyReturns(closesFor(symbol))
          if (own.length !== benchmarkReturns.length) continue
          const stats = calculateBetaAlpha(own, benchmarkReturns, 0)
          if (stats && Number.isFinite(stats.beta)) betas[symbol] = stats.beta
        }
      } catch {
        // No beta means a young holding is reported as unmeasurable rather than
        // estimated, which is the more honest of the two failure modes.
      }

      // Long history, in memory only. See the note above.
      const prices = new Map<string, PriceBar[]>()
      await Promise.all(
        [...symbols, benchmarkSymbol].map(async (symbol) => {
          try {
            const history = await getHistory(symbol, 'max')
            const bars: PriceBar[] = []
            for (const point of history) {
              // Adjusted close is the right basis across decades: it carries
              // splits and dividends, both of which matter over 25 years.
              const close = point.adjClose ?? point.close
              if (close == null || !Number.isFinite(close)) continue
              bars.push({ date: new Date(point.date).toISOString().slice(0, 10), close })
            }
            if (bars.length > 0) prices.set(symbol, bars)
          } catch {
            // A symbol with no long history simply cannot speak to old episodes.
          }
        }),
      )

      const holdings = positions.map((p, i) => ({
        symbol: p.symbol,
        weight: values[i] / bookValue,
        beta: betas[p.symbol],
      }))

      const results = stressTestPortfolio(holdings, prices, benchmarkSymbol)

      return {
        benchmark_symbol: benchmarkSymbol,
        // Every episode in the catalogue, so the interface can show which ones
        // could not be measured rather than quietly omitting them.
        episodes_catalogued: HISTORICAL_EPISODES.length,
        episodes_measured: results.length,
        unmeasured: HISTORICAL_EPISODES.filter(
          (e) => !results.some((r) => r.episode.id === e.id),
        ).map((e) => ({
          id: e.id,
          name: e.name,
          reason:
            'Ninguna de tus posiciones tiene historial ni beta que cubra ese periodo, asi que no hay nada que medir y no se inventa nada.',
        })),
        // Long ranges come back monthly from the provider, so peak-to-trough is
        // measured on month boundaries and understates the true extreme
        // slightly. Said out loud rather than left for someone to discover.
        granularity_note:
          'Los episodios anteriores a 2020 se miden con barras mensuales, que es lo mas fino que entrega el proveedor para rangos de decadas. La caida real entre el pico y el valle exactos fue algo mayor que la que se muestra.',
        results: results.map((result) => ({
          ...result,
          summary: describeStressResult(result),
        })),
      }
    }
  )

  return success(data)
}

export const GET = apiHandler(getHandler)
