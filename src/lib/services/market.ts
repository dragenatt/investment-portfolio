const YAHOO_BASE = 'https://query1.finance.yahoo.com/v1/finance'

export async function searchSymbols(query: string) {
  const res = await fetch(
    `${YAHOO_BASE}/search?q=${encodeURIComponent(query)}&quotesCount=10&lang=en-US`,
    { next: { revalidate: 60 } }
  )
  if (!res.ok) return []
  const data = await res.json()
  return (data.quotes || []).map((q: Record<string, unknown>) => ({
    symbol: q.symbol,
    name: q.shortname || q.longname,
    type: q.quoteType,
    exchange: q.exchange,
    exchDisp: q.exchDisp,
  }))
}

export async function getQuote(symbol: string) {
  const res = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`,
    { next: { revalidate: 30 } }
  )
  if (!res.ok) return null
  const data = await res.json()
  const result = data.chart?.result?.[0]
  if (!result) return null

  const meta = result.meta
  return {
    symbol: meta.symbol,
    price: meta.regularMarketPrice,
    previousClose: meta.previousClose,
    change: meta.regularMarketPrice - meta.previousClose,
    changePct: ((meta.regularMarketPrice - meta.previousClose) / meta.previousClose) * 100,
    currency: meta.currency,
    exchange: meta.exchangeName,
    marketState: meta.marketState,
  }
}

export async function getHistory(symbol: string, range: string = '1mo') {
  const intervalMap: Record<string, string> = {
    '1d': '5m', '5d': '15m', '1mo': '1d', '3mo': '1d',
    '6mo': '1d', '1y': '1wk', '5y': '1mo', 'max': '1mo',
  }
  const interval = intervalMap[range] || '1d'

  const res = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`,
    { next: { revalidate: 300 } }
  )
  if (!res.ok) return []
  const data = await res.json()
  const result = data.chart?.result?.[0]
  if (!result) return []

  const timestamps = result.timestamp || []
  const quotes = result.indicators?.quote?.[0] || {}

  return timestamps.map((t: number, i: number) => ({
    date: new Date(t * 1000).toISOString(),
    open: quotes.open?.[i],
    high: quotes.high?.[i],
    low: quotes.low?.[i],
    close: quotes.close?.[i],
    volume: quotes.volume?.[i],
  })).filter((p: { close: number | null }) => p.close !== null)
}
