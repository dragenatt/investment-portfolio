import useSWR from 'swr'
import { apiFetcher } from '@/lib/api/fetcher'

export type HistoryDataPoint = { date: string; value: number; normalized?: number }

/**
 * Every shape the route answers with now carries the currency its values are
 * in.
 *
 * It did not, and the chart drew a sum of provider closes — dollars, pesos,
 * reais and yen added together — under a header already converted to the
 * reader's currency. `currency: null` means the figures were NOT converted,
 * which the nightly-snapshot branch is honest enough to say rather than claim
 * a unit nobody applied.
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

export function usePortfolioHistory(range: string) {
  const { data, ...rest } = useSWR<PortfolioHistoryResponse>(
    `/api/portfolio/history?range=${range}`,
    apiFetcher,
    { refreshInterval: 60_000 }
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
