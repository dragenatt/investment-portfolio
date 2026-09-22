import useSWR from 'swr'
import { apiFetcher } from '@/lib/api/fetcher'

export type HistoryDataPoint = { date: string; value: number; normalized?: number }

/**
 * Every shape the route answers with now carries the currency its values are
 * in.
 *
 * It did not, and the chart drew a sum of provider closes — dollars, pesos,
 * reais and yen added together — under a header already converted to the
 * reader's currency. `currency: null` would mean the figures were NOT
 * converted; every branch now answers in the currency it was asked for.
 */
export type PortfolioHistoryResponse = {
  timeline: Array<{ date: string; value: number; normalized?: number }>
  benchmark?: { dates: string[]; values: number[] }
  benchmarkSymbol?: string
  source?: 'snapshots' | 'fallback'
  currency?: string | null
  /** Every currency involved in the conversion, the base included. */
  currencies?: string[] | null
  /** Holdings left in their own currency because nothing could convert them. */
  unconverted?: string[] | null
}

/**
 * `currency` is the display currency the rest of the screen is in. It is part
 * of the request, so the series comes back in the same unit as the header
 * above it, and changing the currency asks for the series again.
 */
export function usePortfolioHistory(range: string, currency: string) {
  const { data, ...rest } = useSWR<PortfolioHistoryResponse>(
    `/api/portfolio/history?range=${range}&currency=${encodeURIComponent(currency)}`,
    apiFetcher,
    // 1D and 1W are drawn from intraday bars that land every few minutes;
    // the longer ranges from daily closes that change once a day. The line's
    // present comes from the live prices either way (live-point.ts), so asking
    // for a daily series every minute, as this did, recomputed it for nothing.
    { refreshInterval: range === '1' || range === '7' ? 60_000 : 10 * 60_000 }
  )

  const timeline = data?.timeline ?? []

  return {
    data: timeline as HistoryDataPoint[],
    timeline,
    benchmark: data?.benchmark ?? { dates: [] as string[], values: [] as number[] },
    benchmarkSymbol: data?.benchmarkSymbol ?? 'SPY',
    currency: data?.currency ?? null,
    unconverted: data?.unconverted ?? null,
    ...rest,
  }
}
