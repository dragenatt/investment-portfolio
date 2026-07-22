import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { getHistory } from '@/lib/services/market'
import { computeTechnicalSignal } from '@/lib/services/signal'
import { withCache } from '@/lib/cache/with-cache'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const { symbol } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const data = await withCache(
    `market:signal:${symbol.toUpperCase()}`,
    3600, // 1h — the signal only moves with daily closes
    async () => {
      const history = (await getHistory(symbol, '6mo')) as Array<{ close: number | null }>
      const closes = (history ?? [])
        .map((h) => h.close)
        .filter((c): c is number => c != null && Number.isFinite(c))
      return computeTechnicalSignal(closes)
    }
  )

  return success(data)
}
