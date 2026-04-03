/**
 * Finnhub API client (free tier fallback)
 * https://finnhub.io/docs/api
 *
 * Free tier: 60 calls/min, real-time US stock quotes
 * - /quote = real-time quote
 * - /stock/candle = historical OHLCV
 * - /search = symbol lookup
 */

const BASE = 'https://finnhub.io/api/v1'

function getApiKey(): string | null {
  return process.env.FINNHUB_API_KEY || null
}

export type FinnhubQuote = {
  symbol: string
  price: number | null
  previousClose: number | null
  change: number | null
  changePct: number | null
  currency: string
  exchange: string
}

export type FinnhubBar = {
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

/**
 * Search for symbols using Finnhub
 * GET /search?q={query}&token={key}
 * Note: Finnhub search is limited compared to Twelve Data
 */
export async function searchSymbols(query: string): Promise<Array<{
  symbol: string
  name: string
  type: string
  exchange: string
  exchDisp: string
}>> {
  const apiKey = getApiKey()
  if (!apiKey) return []

  const res = await fetch(
    `${BASE}/search?q=${encodeURIComponent(query)}&token=${apiKey}`,
    { next: { revalidate: 60 } } as RequestInit
  )
  if (!res.ok) return []

  const data = await res.json()
  if (!data.result) return []

  return data.result.slice(0, 10).map((item: Record<string, unknown>) => ({
    symbol: item.symbol as string,
    name: item.description as string || (item.symbol as string),
    type: 'stock',
    exchange: item.type as string || 'UNKNOWN',
    exchDisp: item.type as string || 'UNKNOWN',
  }))
}

/**
 * Get current quote
 * GET /quote?symbol={symbol}&token={key}
 * Returns: c=current, pc=prev close, d=change, dp=changePct
 */
export async function getQuote(symbol: string): Promise<FinnhubQuote | null> {
  const apiKey = getApiKey()
  if (!apiKey) return null

  const res = await fetch(
    `${BASE}/quote?symbol=${encodeURIComponent(symbol)}&token=${apiKey}`,
    { next: { revalidate: 30 } } as RequestInit
  )
  if (!res.ok) return null

  const data = await res.json()

  // Finnhub returns error if symbol not found or has a negative d value with 0 c
  if (!data.c || data.c === 0) return null

  const price = data.c ? parseFloat(data.c) : null
  const previousClose = data.pc ? parseFloat(data.pc) : null
  const change = data.d ? parseFloat(data.d) : null
  const changePct = data.dp ? parseFloat(data.dp) : null

  return {
    symbol,
    price,
    previousClose,
    change,
    changePct,
    currency: 'USD',
    exchange: '',
  }
}

/**
 * Get historical OHLCV data
 * GET /stock/candle?symbol={symbol}&resolution={res}&from={from}&to={to}&token={key}
 * resolution: 1 (minute), 5, 15, 30, 60 (hour), D (day), W (week), M (month)
 */
export async function getHistory(
  symbol: string,
  range: string = '1mo'
): Promise<FinnhubBar[]> {
  const apiKey = getApiKey()
  if (!apiKey) return []

  // Map our range format to Finnhub parameters
  const rangeConfig: Record<string, { resolution: string; days: number }> = {
    '1d': { resolution: '5', days: 1 },      // 5-minute bars
    '5d': { resolution: '15', days: 5 },     // 15-minute bars
    '1mo': { resolution: 'D', days: 30 },    // daily
    '3mo': { resolution: 'D', days: 90 },
    '6mo': { resolution: 'D', days: 180 },
    '1y': { resolution: 'W', days: 365 },    // weekly
    '5y': { resolution: 'M', days: 1825 },   // monthly
    'max': { resolution: 'M', days: 10950 }, // ~30 years
  }

  const config = rangeConfig[range] || { resolution: 'D', days: 30 }

  // Calculate from/to timestamps (in seconds, Unix time)
  const toTime = Math.floor(Date.now() / 1000)
  const fromTime = toTime - config.days * 86400

  const res = await fetch(
    `${BASE}/stock/candle?symbol=${encodeURIComponent(symbol)}&resolution=${config.resolution}&from=${fromTime}&to=${toTime}&token=${apiKey}`,
    { next: { revalidate: 300 } } as RequestInit
  )
  if (!res.ok) return []

  const data = await res.json()

  // Finnhub returns: t (timestamp), o (open), h (high), l (low), c (close), v (volume)
  if (!data.t || !Array.isArray(data.t)) return []

  return data.t
    .map((timestamp: number, i: number) => ({
      date: new Date(timestamp * 1000).toISOString(),
      open: data.o?.[i] ? parseFloat(data.o[i]) : null,
      high: data.h?.[i] ? parseFloat(data.h[i]) : null,
      low: data.l?.[i] ? parseFloat(data.l[i]) : null,
      close: data.c?.[i] ? parseFloat(data.c[i]) : null,
      volume: data.v?.[i] ? parseInt(data.v[i]) : null,
    }))
    .filter((p: FinnhubBar) => p.close !== null)
}
