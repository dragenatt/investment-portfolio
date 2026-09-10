import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { withCache } from '@/lib/cache/with-cache'
import { apiHandler } from '@/lib/api/handler'
import { getHistory } from '@/lib/services/market'
import { adjustSeriesBySymbol } from '@/lib/services/corporate-actions'
import { getRiskFreeRate } from '@/lib/services/risk-free-rate'
import { compareAssets, type Bar } from '@/lib/services/asset-compare'

const MAX_SYMBOLS = 6

/**
 * Compare several assets over the window they all share.
 *
 * The comparison a beginner reaches for — which one went up more — ignores
 * everything that made the ride different. Two assets can post the same
 * five-year return with completely different drawdowns, and only one of them
 * was actually holdable.
 */
async function getHandler(req: Request) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const url = new URL(req.url)
  const raw = url.searchParams.get('symbols')
  if (!raw) return error('symbols query parameter is required', 400)

  const symbols = [...new Set(raw.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean))]
  if (symbols.length < 2) return error('At least two symbols are needed to compare', 400)
  if (symbols.length > MAX_SYMBOLS) {
    return error(`At most ${MAX_SYMBOLS} symbols can be compared at once`, 400)
  }

  const range = url.searchParams.get('range') ?? '1y'
  const benchmark = url.searchParams.get('benchmark')?.toUpperCase()
  const initial = Number(url.searchParams.get('amount') ?? 10000)

  const data = await withCache(
    `market:compare:${symbols.slice().sort().join(',')}:${range}:${benchmark ?? ''}:${initial}`,
    3600,
    async () => {
      const seriesBySymbol: Record<string, Bar[]> = {}

      await Promise.all(
        symbols.map(async (symbol) => {
          try {
            const history = (await getHistory(symbol, range)) as Array<{
              date: string
              close: number | null
            }>
            // Split-adjusted, or a split shows up as a crash and every metric
            // downstream of it is wrong.
            const adjusted = adjustSeriesBySymbol(
              (history ?? [])
                .filter((h) => h.close != null && Number.isFinite(h.close))
                .map((h) => ({
                  symbol,
                  date: String(h.date).slice(0, 10),
                  close: h.close as number,
                })),
            )
            seriesBySymbol[symbol] = adjusted.map((r) => ({ date: r.date, close: r.close }))
          } catch {
            // One symbol failing leaves it out of the comparison rather than
            // taking the whole request down; compareAssets reports it as excluded.
            seriesBySymbol[symbol] = []
          }
        }),
      )

      const riskFree = await getRiskFreeRate('USD')
      const result = compareAssets(seriesBySymbol, {
        initialInvestment: Number.isFinite(initial) && initial > 0 ? initial : 10000,
        riskFreeRate: riskFree.rate,
        benchmarkSymbol: benchmark && symbols.includes(benchmark) ? benchmark : undefined,
      })

      if (!result) return { message: 'Not enough overlapping history to compare these assets' }

      return {
        range,
        risk_free_rate: { annual_pct: riskFree.rate * 100, source: riskFree.source },
        ...result,
      }
    }
  )

  return success(data)
}

export const GET = apiHandler(getHandler)
