/**
 * Benchmark Data Service
 *
 * Fetches and stores daily benchmark prices (SPY, IPC, QQQ, ACWI).
 * Data source priority: Twelve Data → Finnhub → Yahoo Finance.
 */

import { type SupabaseClient } from '@supabase/supabase-js'

/**
 * Benchmarks a portfolio can be measured against.
 *
 * Currency matters more than it looks. Alpha, beta, tracking error and
 * information ratio are all statements about a comparison, so measuring a peso
 * book against SPY says as much about the exchange rate as about the portfolio.
 * EWW is a US-listed Mexican equity fund, which is the closest a US price feed
 * gets to the IPC without a second data source; it is still quoted in dollars,
 * and that is recorded here rather than glossed over.
 */
export const BENCHMARKS = [
  { symbol: 'SPY', name: 'S&P 500', currency: 'USD' },
  { symbol: 'QQQ', name: 'NASDAQ 100', currency: 'USD' },
  { symbol: 'EWW', name: 'Mexico (MSCI Mexico ETF)', currency: 'USD' },
  { symbol: 'VT', name: 'Global equity (all countries)', currency: 'USD' },
  { symbol: 'AGG', name: 'US aggregate bonds', currency: 'USD' },
] as const

/** Used when a portfolio has not chosen one. */
export const DEFAULT_BENCHMARK = 'SPY'

export function isKnownBenchmark(symbol: string): boolean {
  return BENCHMARKS.some((b) => b.symbol === symbol)
}

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

/**
 * The benchmark a portfolio is measured against.
 *
 * Falls back to the default when the column is absent, which is what happens
 * between deploying this code and applying migration 013. A missing column
 * should degrade to the old behaviour, not break every risk page.
 */
export async function getPortfolioBenchmark(
  supabase: SupabaseClient,
  portfolioId: string,
): Promise<string> {
  const { data, error } = await supabase
    .from('portfolios')
    .select('benchmark_symbol')
    .eq('id', portfolioId)
    .single()

  if (error || !data?.benchmark_symbol) return DEFAULT_BENCHMARK
  return isKnownBenchmark(data.benchmark_symbol) ? data.benchmark_symbol : DEFAULT_BENCHMARK
}
