import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { withCache } from '@/lib/cache/with-cache'
import { apiHandler } from '@/lib/api/handler'
import { loadBookTransactions, loadPriceMap, periodCutoff, RETURN_PERIODS } from '@/lib/services/book-inputs'
import { reconstructBookHistory } from '@/lib/services/portfolio-history'
import { isGranularity, temporalAttribution } from '@/lib/services/temporal-attribution'

// Contribution of each holding over time (P2-4): ?granularity=day|week|month|quarter|year
// and ?period=1M|3M|6M|YTD|1Y|ALL. The book is rebuilt from the transactions and
// closes with the same inputs and convention as the time-weighted return, and
// the whole window links to that return.

async function getHandler(req: Request, { params }: { params: Promise<{ pid: string }> }) {
  const { pid } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const url = new URL(req.url)
  const granularity = url.searchParams.get('granularity') ?? 'month'
  const period = url.searchParams.get('period') ?? '1Y'
  if (!isGranularity(granularity)) return error('granularity must be day, week, month, quarter or year', 400)
  if (!(RETURN_PERIODS as readonly string[]).includes(period)) return error(`period must be one of ${RETURN_PERIODS.join(', ')}`, 400)

  const data = await withCache(`analytics:temporal-attribution:${user.id}:${pid}:${period}:${granularity}`, 600, async () => {
    const cutoff = periodCutoff(period)
    // RLS decides what this user may read; another user's private portfolio
    // simply has no transactions here.
    const transactions = await loadBookTransactions(supabase, pid)
    if (transactions.length === 0) return { granularity, period, from: cutoff, buckets: [], total: null, unmeasurable: 0, unlinkable: 0 }

    const symbols = [...new Set(transactions.map((t) => t.symbol))]
    const prices = await loadPriceMap(supabase, symbols, cutoff, period)
    const history = reconstructBookHistory(transactions, prices, { from: cutoff })
    return { period, from: cutoff, ...temporalAttribution(history, granularity) }
  })

  return success(data)
}

export const GET = apiHandler(getHandler)
