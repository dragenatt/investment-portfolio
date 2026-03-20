import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { getHistory } from '@/lib/services/market'

export async function GET(req: Request, { params }: { params: Promise<{ pid: string }> }) {
  const { pid } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const url = new URL(req.url)
  const vs = url.searchParams.get('vs') || 'SPY'
  const benchmarks = vs.split(',').slice(0, 3)

  const results: Record<string, Array<{ date: string; value: number }>> = {}

  for (const symbol of benchmarks) {
    const history = await getHistory(symbol.trim(), '1y')
    if (history.length > 0) {
      const base = history[0].close
      results[symbol.trim()] = history.map((h: { date: string; close: number }) => ({
        date: h.date,
        value: ((h.close - base) / base) * 100,
      }))
    }
  }

  return success(results)
}
