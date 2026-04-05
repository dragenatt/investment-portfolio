import useSWR from 'swr'
import { apiFetcher } from '@/lib/api/fetcher'

export type HistoryDataPoint = { date: string; value: number; normalized?: number }

export type PortfolioHistoryResponse = {
  timeline: Array<{ date: string; value: number; normalized: number }>
  benchmark: { dates: string[]; values: number[] }
  benchmarkSymbol: string
  source: 'snapshots' | 'fallback'
} | Array<{ date: string; value: number }>

type SnapshotResponse = {
  timeline: Array<{ date: string; value: number; normalized: number }>
  benchmark: { dates: string[]; values: number[] }
  benchmarkSymbol: string
  source: 'snapshots' | 'fallback'
}

function isSnapshotResponse(
  data: PortfolioHistoryResponse
): data is SnapshotResponse {
  return data != null && !Array.isArray(data) && 'timeline' in data
}

export function usePortfolioHistory(range: string) {
  const { data, ...rest } = useSWR<PortfolioHistoryResponse>(
    `/api/portfolio/history?range=${range}`,
    apiFetcher,
    { refreshInterval: 60_000 }
  )

  // Normalize to flat array for backward compatibility with PortfolioChart
  const chartData: HistoryDataPoint[] = data
    ? isSnapshotResponse(data)
      ? data.timeline.map(t => ({ date: t.date, value: t.value, normalized: t.normalized }))
      : (data as Array<{ date: string; value: number }>)
    : []

  // Extract benchmark data if available
  const benchmark = data && isSnapshotResponse(data)
    ? data.benchmark
    : { dates: [] as string[], values: [] as number[] }

  const benchmarkSymbol = data && isSnapshotResponse(data)
    ? data.benchmarkSymbol
    : 'SPY'

  const timeline = data && isSnapshotResponse(data)
    ? data.timeline
    : []

  return {
    data: chartData,
    timeline,
    benchmark,
    benchmarkSymbol,
    ...rest,
  }
}
