import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { withAuditedCache } from '@/lib/cache/with-cache'
import { buildResultMetadata, COMMON_ASSUMPTIONS, type PriceSource } from '@/lib/services/result-metadata'
import { CACHE_KEYS } from '@/lib/cache/redis'
import {
  calculateSimpleReturn,
  calculateTWR,
  calculateMWR,
  describeReturnDifference,
  capitalWeightedAgeDays,
  calendarReturns,
} from '@/lib/services/returns'
import { reconstructBookHistory } from '@/lib/services/portfolio-history'
import { loadBookTransactions, loadPriceMapWithSource, periodCutoff } from '@/lib/services/book-inputs'
import { historicalFx } from '@/lib/services/fx-history'
import { bookInBase } from '@/lib/services/book-currency'
import { valueBookInBase } from '@/lib/services/book-valuation'
import { SNAPSHOT_VALUATION_VERSION } from '@/lib/services/snapshots'
import { apiHandler } from '@/lib/api/handler'

async function getHandler(req: Request, { params }: { params: Promise<{ pid: string }> }) {
  const { pid } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const url = new URL(req.url)
  const period = url.searchParams.get('period') || '1Y'

  const data = await withAuditedCache(
    // v2: every figure in the portfolio's base currency. Results cached before
    // mixed pesos and dollars and must not be served.
    `${CACHE_KEYS.ANALYTICS_RETURNS}${user.id}:${pid}:${period}:v2`,
    600,
    async () => {
      const cutoff = periodCutoff(period)

      // Try snapshots first — only those valued in the base currency (024).
      const { data: snapshots } = await supabase
        .from('portfolio_snapshots')
        .select('snapshot_date, total_value, total_cost')
        .eq('portfolio_id', pid)
        .gte('snapshot_date', cutoff)
        .gte('valuation_version', SNAPSHOT_VALUATION_VERSION)
        .order('snapshot_date', { ascending: true })

      const { data: portfolio } = await supabase.from('portfolios').select('base_currency').eq('id', pid).maybeSingle()
      const base = String(portfolio?.base_currency ?? 'USD').toUpperCase()

      const { data: positions } = await supabase
        .from('positions')
        .select('symbol, quantity, avg_cost, currency')
        .eq('portfolio_id', pid)
        .gt('quantity', 0)

      // Every transaction, not just those in the window: the holdings on the
      // first day of the window depend on everything bought before it.
      const recorded = await loadBookTransactions(supabase, pid)

      // One currency for everything below (book-currency.ts). Transaction prices
      // are in what each trade was recorded in; closes in what each symbol
      // trades in. Compared unconverted, a book of dollar assets bought in pesos
      // read as down 94% on capital that had moved a fraction of a percent.
      const symbols = [...new Set([...recorded.map((t) => t.symbol), ...(positions ?? []).map((p) => p.symbol as string)])]
      const firstTrade = recorded[0]?.executed_at.slice(0, 10) ?? cutoff
      const fx = await historicalFx(
        supabase,
        symbols,
        [...recorded.map((t) => t.currency ?? 'USD'), ...(positions ?? []).map((p) => String(p.currency ?? 'USD'))],
        base,
        firstTrade < cutoff ? firstTrade : cutoff,
      )
      const unconverted = new Set<string>()
      const inBase = bookInBase(recorded, {}, fx.conversion, fx.cashFactor)
      inBase.unconverted.forEach((s) => unconverted.add(s))
      const bookTransactions = inBase.transactions
      const inWindow = bookTransactions.filter((t) => t.executed_at.slice(0, 10) >= cutoff)

      // MWR keeps its investor convention, unchanged: a purchase is money
      // leaving the investor's pocket (negative), a sale money coming back.
      const investorFlows = inWindow
        .filter((t) => t.type === 'buy' || t.type === 'sell')
        .map((t) => ({
          date: t.executed_at.split('T')[0],
          amount: t.type === 'buy' ? -t.quantity * t.price : t.quantity * t.price,
        }))

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
      let priceSource: PriceSource = 'stored'
      let basis = 'Fotos nocturnas del valor del portafolio y sus operaciones'

      // FALLBACK: no stored snapshots, so rebuild the book from the transactions
      // and price history.
      if (snaps.length < 2) {
        const loaded = await loadPriceMapWithSource(supabase, symbols, cutoff, period)
        const converted = bookInBase([], loaded.prices, fx.conversion, fx.cashFactor)
        converted.unconverted.forEach((s) => unconverted.add(s))
        const priceMap = converted.prices
        priceSource = loaded.source
        basis = 'Portafolio reconstruido de sus operaciones y precios de cierre diarios'

        // The book as it stood on each date — not today's holdings carried
        // backwards — with flows valued at the same closes. See
        // reconstructBookHistory for why the flows use the close.
        const book = reconstructBookHistory(bookTransactions, priceMap, { from: cutoff })
        snaps = book.snapshots
        twrFlows = book.flows

        // What the current holdings are worth at their latest close, in the
        // base currency at today's rate. The rebuilt last snapshot cannot stand
        // in for it — it is the book BEFORE that day's trades.
        if (positions && positions.length > 0) {
          const latest: Record<string, number> = {}
          for (const [symbol, closes] of Object.entries(loaded.prices)) {
            const dates = Object.keys(closes).sort()
            if (dates.length > 0) latest[symbol] = closes[dates[dates.length - 1]]
          }
          const valuation = await valueBookInBase(supabase, positions, latest, base)
          valuation.unconverted.forEach((s) => unconverted.add(s))
          currentValue = valuation.total
        } else {
          currentValue = null
        }
      }

      // What the open positions cost, each average cost converted from the
      // currency it was recorded in.
      const costs = await valueBookInBase(supabase, positions ?? [], {}, base)
      costs.unconverted.forEach((s) => unconverted.add(s))
      const totalCost = costs.total

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
          /** Every figure above is in this currency. */
          currency: base,
          /** Holdings whose rate was unknown and were left as they were. */
          unconverted: [...unconverted],
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
        _meta: buildResultMetadata({
          model: 'returns',
          data: { description: basis, symbols: [...new Set(bookTransactions.map((t) => t.symbol))], priceSource },
          period: { from: snaps[0]?.date ?? cutoff, to: snaps[snaps.length - 1]?.date ?? null, observations: snaps.length, cadence: '1 dia' },
          assumptions: [
            COMMON_ASSUMPTIONS.priceReturn,
            { name: 'TWR', value: 'Libro antes de las operaciones del día; flujos valuados al cierre', source: 'returns.ts, portfolio-history.ts' },
            { name: 'MWR', value: 'TIR anual de los flujos del inversionista hasta el valor actual', source: 'returns.ts (XIRR)' },
            { name: 'Rendimiento simple', value: 'No realizado, sobre el costo de las posiciones abiertas', source: 'returns.ts' },
            { name: 'Moneda', value: `Todo en ${base}: cierres al tipo de cambio de su fecha, operaciones al de la suya`, source: 'book-currency.ts, fx.ts' },
          ],
        }),
      }
    }
  )

  return success(data)
}

export const GET = apiHandler(getHandler)
