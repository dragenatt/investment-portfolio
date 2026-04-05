/**
 * Benchmark Data Service
 *
 * Fetches and stores daily benchmark prices (SPY, IPC, QQQ, ACWI).
 * Data source priority: Twelve Data → Finnhub → Yahoo Finance.
 */

import { type SupabaseClient } from '@supabase/supabase-js'

export const BENCHMARKS = [
  { symbol: 'SPY', name: 'S&P 500 ETF', currency: 'USD' },
  { symbol: 'QQQ', name: 'NASDAQ 100 ETF', currency: 'USD' },
] as const

export type BenchmarkSymbol = (typeof BENCHMARKS)[number]['symbol']

/**
 * Fetch today's benchmark close prices and store them.
 */
export async function fetchAndStoreBenchmarks(supabase: SupabaseClient): Promise<number> {
  const apiKey = process.env.TWELVE_DATA_API_KEY
  let stored = 0
  const today = new Date().toISOString().split('T')[0]

  for (const benchmark of BENCHMARKS) {
    try {
      let close: number | null = null

      // Try Twelve Data first
      if (apiKey) {
        const res = await fetch(
          `https://api.twelvedata.com/price?symbol=${benchmark.symbol}&apikey=${apiKey}`,
          { signal: AbortSignal.timeout(10000) }
        )
        if (res.ok) {
          const data = await res.json()
          if (data.price) close = parseFloat(data.price)
        }
      }

      // Fallback to Finnhub
      if (close === null && process.env.FINNHUB_API_KEY) {
        const res = await fetch(
          `https://finnhub.io/api/v1/quote?symbol=${benchmark.symbol}&token=${process.env.FINNHUB_API_KEY}`,
          { signal: AbortSignal.timeout(10000) }
        )
        if (res.ok) {
          const data = await res.json()
          if (data.c) close = data.c
        }
      }

      if (close !== null) {
        // Get yesterday's close for change_pct
        const { data: yesterday } = await supabase
          .from('benchmark_prices')
          .select('close')
          .eq('symbol', benchmark.symbol)
          .lt('date', today)
          .order('date', { ascending: false })
          .limit(1)
          .single()

        const changePct = yesterday
          ? ((close - yesterday.close) / yesterday.close) * 100
          : null

        await supabase.from('benchmark_prices').upsert(
          { symbol: benchmark.symbol, date: today, close, change_pct: changePct },
          { onConflict: 'symbol,date' }
        )
        stored++
      }

      // Rate limit delay
      await new Promise((r) => setTimeout(r, 1500))
    } catch (err) {
      console.error(`[benchmarks] Failed to fetch ${benchmark.symbol}:`, err)
    }
  }

  return stored
}

/**
 * Get benchmark prices for a date range, normalized to start at 100.
 */
export async function getBenchmarkSeries(
  supabase: SupabaseClient,
  symbol: string,
  fromDate: string,
  toDate: string
): Promise<{ dates: string[]; values: number[] }> {
  const { data } = await supabase
    .from('benchmark_prices')
    .select('date, close')
    .eq('symbol', symbol)
    .gte('date', fromDate)
    .lte('date', toDate)
    .order('date', { ascending: true })

  if (!data || data.length === 0) return { dates: [], values: [] }

  const startClose = data[0].close
  return {
    dates: data.map((d) => d.date),
    values: data.map((d) => (d.close / startClose) * 100),
  }
}
