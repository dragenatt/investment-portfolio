import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { getHistory } from '@/lib/services/market'
import { assessPriceHistory, type PriceBar } from '@/lib/services/data-quality'
import { withCache } from '@/lib/cache/with-cache'
import { apiHandler } from '@/lib/api/handler'

/**
 * Data quality report for one asset's price history.
 *
 * Advisory only: nothing here blocks a metric. It exists so a reader can see
 * that the Sharpe ratio they are looking at was computed on a series with a
 * three-week hole in it. See docs/DATA_QUALITY.md.
 */
async function getHandler(
  _req: Request,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const { symbol } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const upper = symbol.toUpperCase()

  const data = await withCache(
    `market:data-quality:${upper}`,
    3600, // 1h — the verdict only moves with daily closes
    async () => {
      const history = (await getHistory(symbol, '1y')) as Array<{
        date: string
        close: number | null
        volume?: number | null
      }>
      const bars: PriceBar[] = (history ?? []).map((h) => ({
        // Providers hand back either a plain date or a full timestamp.
        date: String(h.date).slice(0, 10),
        close: h.close,
        volume: h.volume ?? null,
      }))
      return assessPriceHistory(upper, bars)
    }
  )

  return success(data)
}

export const GET = apiHandler(getHandler)
