import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { getHistory } from '@/lib/services/market'
import { apiHandler } from '@/lib/api/handler'

async function getHandler(req: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const url = new URL(req.url)
  const range = url.searchParams.get('range') || '1mo'

  // The cache this route used to own now lives inside getHistory, under the
  // same key and the same TTLs — so /stats, /signal and the chart share it
  // instead of each paying for its own copy of the same series.
  const history = await getHistory(symbol, range)
  return success(history)
}

export const GET = apiHandler(getHandler)
