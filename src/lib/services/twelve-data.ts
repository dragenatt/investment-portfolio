/**
 * Twelve Data API client
 * https://twelvedata.com/docs
 *
 * Free tier: 800 credits/day, 8 credits/min
 * - /quote = 1 credit
 * - /time_series = 1 credit
 * - /symbol_search = no credit needed
 */

const BASE = 'https://api.twelvedata.com'

function getApiKey(): string | null {
  return process.env.TWELVE_DATA_API_KEY || null
}

export type TwelveDataQuote = {
  symbol: string
  price: number | null
  previousClose: number | null
  change: number | null
  changePct: number | null
  currency: string
  exchange: string
  name: string
}

export type TwelveDataBar = {
  date: string
  open: number | null
  high: number | null
  low: number | null
  close: number | null
  volume: number | null
}

export async function isAvailable(): Promise<boolean> {
  return !!getApiKey()
}

export async function searchSymbols(query: string): Promise<Array<{
  symbol: string
  name: string
  type: string
  exchange: string
  exchDisp: string
}>> {
  // symbol_search doesn't require API key
  const res = await fetch(
    `${BASE}/symbol_search?symbol=${encodeURIComponent(query)}&outputsize=10`,
    { next: { revalidate: 60 } } as RequestInit
  )
  if (!res.ok) return []
  const data = await res.json()
  if (!data.data) return []

  return data.data.map((item: Record<string, string>) => ({
    symbol: item.symbol,
    name: item.instrument_name,
    type: item.instrument_type,
    exchange: item.exchange,
    exchDisp: item.exchange,
  }))
}

export async function getQuote(symbol: string): Promise<TwelveDataQuote | null> {
  const apiKey = getApiKey()
  if (!apiKey) return null

  const res = await fetch(
    `${BASE}/quote?symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}`,
    { next: { revalidate: 30 } } as RequestInit
  )
  if (!res.ok) return null

  const data = await res.json()
  if (data.status === 'error' || data.code) return null

  const price = data.close ? parseFloat(data.close) : null
  const previousClose = data.previous_close ? parseFloat(data.previous_close) : null
  const change = data.change ? parseFloat(data.change) : null
  const changePct = data.percent_change ? parseFloat(data.percent_change) : null

  return {
    symbol: data.symbol || symbol,
    price,
    previousClose,
    change,
    changePct,
    currency: data.currency || 'USD',
    exchange: data.exchange || '',
    name: data.name || symbol,
  }
}

export async function getHistory(
  symbol: string,
  range: string = '1mo'
): Promise<TwelveDataBar[]> {
  const apiKey = getApiKey()
  if (!apiKey) return []

  // Map our range format to Twelve Data parameters
  const rangeConfig: Record<string, { interval: string; outputsize: number }> = {
    '1d': { interval: '5min', outputsize: 78 },    // ~6.5 hours of trading
    '5d': { interval: '15min', outputsize: 130 },   // 5 days × 26 bars
    '1mo': { interval: '1day', outputsize: 22 },
    '3mo': { interval: '1day', outputsize: 65 },
    '6mo': { interval: '1day', outputsize: 130 },
    '1y': { interval: '1week', outputsize: 52 },
    '5y': { interval: '1month', outputsize: 60 },
    'max': { interval: '1month', outputsize: 240 },
  }

  const config = rangeConfig[range] || { interval: '1day', outputsize: 30 }

  const res = await fetch(
    `${BASE}/time_series?symbol=${encodeURIComponent(symbol)}&interval=${config.interval}&outputsize=${config.outputsize}&apikey=${apiKey}`,
    { next: { revalidate: 300 } } as RequestInit
  )
  if (!res.ok) return []

  const data = await res.json()
  if (data.status === 'error' || !data.values) return []

  return data.values
    .map((v: Record<string, string>) => ({
      date: new Date(v.datetime).toISOString(),
      open: v.open ? parseFloat(v.open) : null,
      high: v.high ? parseFloat(v.high) : null,
      low: v.low ? parseFloat(v.low) : null,
      close: v.close ? parseFloat(v.close) : null,
      volume: v.volume ? parseInt(v.volume) : null,
    }))
    .filter((p: TwelveDataBar) => p.close !== null)
    .reverse() // Twelve Data returns newest first, we want chronological
}

/**
 * Batch quote endpoint — fetches up to 20 symbols in a single API call.
 * Twelve Data /quote?symbol=AAPL,MSFT,GOOG returns all quotes at once.
 * Uses 1 credit per symbol but only 1 HTTP round-trip.
 */
export async function getBatchQuotes(
  symbols: string[]
): Promise<Record<string, TwelveDataQuote>> {
  const apiKey = getApiKey()
  if (!apiKey || symbols.length === 0) return {}

  // Twelve Data accepts comma-separated symbols (max ~120 per call)
  const symbolStr = symbols.slice(0, 20).join(',')
  const res = await fetch(
    `${BASE}/quote?symbol=${encodeURIComponent(symbolStr)}&apikey=${apiKey}`,
    { next: { revalidate: 30 } } as RequestInit
  )
  if (!res.ok) return {}

  const data = await res.json()
  const results: Record<string, TwelveDataQuote> = {}

  // Single symbol returns an object; multiple returns an array
  const items: Array<Record<string, string>> = Array.isArray(data) ? data : [data]

  for (const item of items) {
    if (item.status === 'error' || item.code) continue

    const price = item.close ? parseFloat(item.close) : null
    const previousClose = item.previous_close ? parseFloat(item.previous_close) : null
    const change = item.change ? parseFloat(item.change) : null
    const changePct = item.percent_change ? parseFloat(item.percent_change) : null

    const sym = item.symbol || ''
    if (sym) {
      results[sym] = {
        symbol: sym,
        price,
        previousClose,
        change,
        changePct,
        currency: item.currency || 'USD',
        exchange: item.exchange || '',
        name: item.name || sym,
      }
    }
  }

  return results
}
