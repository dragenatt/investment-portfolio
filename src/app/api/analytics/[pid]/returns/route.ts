import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { withCache } from '@/lib/cache/with-cache'
import { CACHE_KEYS } from '@/lib/cache/redis'
import {
  calculateSimpleReturn,
  calculateTWR,
  calculateMWR,
  describeReturnDifference,
  capitalWeightedAgeDays,
  calendarReturns,
} from '@/lib/services/returns'
import {
  reconstructBookHistory,
  type BookTransaction,
  type PriceMap,
} from '@/lib/services/portfolio-history'
import { getHistory } from '@/lib/services/market'
import { apiHandler } from '@/lib/api/handler'

async function getHandler(req: Request, { params }: { params: Promise<{ pid: string }> }) {
  const { pid } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const url = new URL(req.url)
  const period = url.searchParams.get('period') || '1Y'

  const data = await withCache(
    `${CACHE_KEYS.ANALYTICS_RETURNS}${pid}:${period}`,
    600,
    async () => {
      const cutoff = getPeriodCutoff(period)

      // Try snapshots first
      const { data: snapshots } = await supabase
        .from('portfolio_snapshots')
        .select('snapshot_date, total_value, total_cost')
        .eq('portfolio_id', pid)
        .gte('snapshot_date', cutoff)
        .order('snapshot_date', { ascending: true })

      // Every transaction, not just those in the window: the holdings on the
      // first day of the window depend on everything bought before it.
      const { data: allTransactions } = await supabase
        .from('transactions')
        .select('executed_at, type, quantity, price, position:positions!inner(portfolio_id, symbol)')
        .eq('position.portfolio_id', pid)
        .order('executed_at', { ascending: true })
        // Ties on executed_at (the modal records a date, not a time) replay in entry order.
        .order('created_at', { ascending: true })

      const bookTransactions: BookTransaction[] = (allTransactions ?? []).map((t) => ({
        executed_at: t.executed_at as string,
        type: t.type as BookTransaction['type'],
        symbol: (t.position as unknown as { symbol: string }).symbol,
        quantity: t.quantity as number,
        price: t.price as number,
      }))
      const inWindow = bookTransactions.filter((t) => t.executed_at.slice(0, 10) >= cutoff)

      // MWR keeps its investor convention, unchanged: a purchase is money
      // leaving the investor's pocket (negative), a sale money coming back.
      const investorFlows = inWindow
        .filter((t) => t.type === 'buy' || t.type === 'sell')
        .map((t) => ({
          date: t.executed_at.split('T')[0],
          amount: t.type === 'buy' ? -t.quantity * t.price : t.quantity * t.price,
        }))

      const { data: positions } = await supabase
        .from('positions')
        .select('symbol, quantity, avg_cost')
        .eq('portfolio_id', pid)
        .gt('quantity', 0)

      let snaps = (snapshots ?? []).map((s) => ({ date: s.snapshot_date, value: s.total_value }))
      // TWR takes the book's convention, the opposite sign: a purchase is money
      // flowing INTO the portfolio. Passing the investor-signed array here made
      // the first purchase's opening capital negative and the TWR null.
      let twrFlows = inWindow
        .filter((t) => t.type === 'buy' || t.type === 'sell')
        .map((t) => ({
          date: t.executed_at.split('T')[0],
          amount: t.type === 'buy' ? t.quantity * t.price : -t.quantity * t.price,
        }))
      let currentValue = snaps.length > 0 ? snaps[snaps.length - 1].value : null

      // FALLBACK: no stored snapshots, so rebuild the book from the transactions
      // and price history.
      if (snaps.length < 2) {
        const symbols = [
          ...new Set([...bookTransactions.map((t) => t.symbol), ...(positions ?? []).map((p) => p.symbol)]),
        ]
        const priceMap: PriceMap = {}

        await Promise.all(
          symbols.map(async (symbol) => {
            try {
              // Try DB first
              const { data: cached } = await supabase
                .from('price_history')
                .select('date, close')
                .eq('symbol', symbol)
                .gte('date', cutoff)
                .order('date', { ascending: true })

              if (cached && cached.length >= 5) {
                priceMap[symbol] = {}
                for (const row of cached) priceMap[symbol][row.date] = row.close
                return
              }

              // Fallback to Yahoo
              const range = periodToRange(period)
              const history = await getHistory(symbol, range)
              priceMap[symbol] = {}
              for (const point of history) {
                if (point.close == null) continue
                const date = new Date(point.date).toISOString().slice(0, 10)
                if (date >= cutoff) priceMap[symbol][date] = point.close
              }
            } catch { /* skip */ }
          })
        )

        // The book as it stood on each date — not today's holdings carried
        // backwards — with flows valued at the same closes. See
        // reconstructBookHistory for why the flows use the close.
        const book = reconstructBookHistory(bookTransactions, priceMap, { from: cutoff })
        snaps = book.snapshots
        twrFlows = book.flows

        // What the current holdings are worth at their latest price: the same
        // figure the old last snapshot produced, so simple return and MWR are
        // unchanged by the rebuild. The rebuilt last snapshot cannot stand in
        // for it — it is the book BEFORE that day's trades.
        currentValue =
          positions && positions.length > 0
            ? positions.reduce((sum, pos) => {
                const closes = priceMap[pos.symbol] ?? {}
                const dates = Object.keys(closes).sort()
                const latest = dates.length > 0 ? closes[dates[dates.length - 1]] : pos.avg_cost
                return sum + pos.quantity * latest
              }, 0)
            : null
      }

      // Calculate total cost from positions
      const totalCost = (positions ?? []).reduce((sum, p) => sum + p.quantity * p.avg_cost, 0)

      // Simple return: unrealised, on the holdings still open.
      const simple = currentValue !== null ? calculateSimpleReturn(currentValue, totalCost) : 0

      // TWR judges the strategy, MWR judges the investor's timing on top of it.
      // Both are reported, and null means "not enough history to say" rather
      // than a flat zero.
      const twr = calculateTWR(snaps, twrFlows)
      const mwr = currentValue !== null ? calculateMWR(investorFlows, currentValue, new Date()) : null

      // Calendar returns (monthly), time-weighted so deposits are not gains.
      const calendar = calendarReturns(snaps, twrFlows)

      return {
        summary: {
          simple,
          twr,
          mwr,
          period,
          // Why the two differ, in the terms that caused it. Null when one side
          // could not be computed, because there is nothing to compare.
          // calculateTWR is cumulative over the window and MWR is annual, so the
          // comparison annualises the TWR over the span its snapshots cover.
          difference_explanation: describeReturnDifference(twr, mwr, {
            twrDays:
              snaps.length >= 2
                ? (Date.parse(snaps[snaps.length - 1].date) - Date.parse(snaps[0].date)) / 86_400_000
                : undefined,
          }),
          // How long the money has been invested on average, weighted by size.
          // An annual MWR on capital that is weeks old is an extrapolation, and
          // this is what lets the explanation say so.
          capital_age_days: capitalWeightedAgeDays(investorFlows, new Date()),
        },
        calendar,
        periods: [],
      }
    }
  )

  return success(data)
}

function getPeriodCutoff(period: string): string {
  const now = new Date()
  switch (period) {
    case '1M': now.setMonth(now.getMonth() - 1); break
    case '3M': now.setMonth(now.getMonth() - 3); break
    case '6M': now.setMonth(now.getMonth() - 6); break
    case 'YTD': now.setMonth(0); now.setDate(1); break
    case '1Y': now.setFullYear(now.getFullYear() - 1); break
    case 'ALL': now.setFullYear(2020); break
    default: now.setFullYear(now.getFullYear() - 1)
  }
  return now.toISOString().split('T')[0]
}

function periodToRange(period: string): string {
  switch (period) {
    case '1M': return '1mo'
    case '3M': return '3mo'
    case '6M': return '6mo'
    case 'YTD': return '1y'
    case '1Y': return '1y'
    case 'ALL': return 'max'
    default: return '1y'
  }
}

export const GET = apiHandler(getHandler)
