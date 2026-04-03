import { createClient } from '@supabase/supabase-js'

export interface Env {
  PRICE_CACHE: KVNamespace
  SUPABASE_URL: string
  SUPABASE_SERVICE_ROLE_KEY: string
  TWELVE_DATA_API_KEY: string
  FINNHUB_API_KEY: string
}

interface PriceData {
  symbol: string
  price: number
  change_pct: number
  volume: number
  currency: string
  source: string
  exchange: string
  fetched_at: string
  expires_at: string
}

interface CacheEntry {
  price: PriceData
  timestamp: number
}

const CACHE_TTL_SECONDS = 300 // 5 minutes
const TWELVE_DATA_RATE_LIMIT = 8 // 8 requests per minute (free tier)
const FINNHUB_RATE_LIMIT = 60 // 60 requests per minute
const MARKET_HOURS_START = 9 // 9 AM ET
const MARKET_HOURS_END = 16 // 4 PM ET

// Rate limiter state
let requestCounts: { [key: string]: { count: number; reset: number } } = {}

export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

    switch (event.cron) {
      case '*/5 * * * *':
        // Fetch hot symbols (open positions) during market hours
        ctx.waitUntil(fetchHotPrices(supabase, env))
        break
      case '*/30 * * * *':
        // Fetch warm symbols (watchlists) during market hours
        ctx.waitUntil(fetchWarmPrices(supabase, env))
        break
      case '0 */12 * * *':
        // Daily off-hours processing
        ctx.waitUntil(buildDailyHistory(supabase, env))
        break
    }
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname
    const method = request.method

    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    }

    if (method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders })
    }

    try {
      if (path === '/health') {
        return handleHealth(env, corsHeaders)
      } else if (path === '/prices') {
        return await handleBatchPrices(request, env, corsHeaders)
      } else if (path.startsWith('/price/')) {
        const symbol = path.slice(7).toUpperCase()
        return await handleSinglePrice(symbol, env, corsHeaders)
      } else {
        return new Response(
          JSON.stringify({
            error: 'Not Found',
            endpoints: [
              'GET /health',
              'GET /prices?symbols=AAPL,MSFT,GOOG',
              'GET /price/:symbol',
            ],
          }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      return new Response(
        JSON.stringify({ error: 'Internal Server Error', message: errorMsg }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
  },
}

async function handleHealth(env: Env, corsHeaders: Record<string, string>): Promise<Response> {
  return new Response(
    JSON.stringify({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      service: 'price-engine',
      version: '1.0.0',
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function handleBatchPrices(
  request: Request,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  const url = new URL(request.url)
  const symbolsParam = url.searchParams.get('symbols')

  if (!symbolsParam) {
    return new Response(
      JSON.stringify({ error: 'Missing symbols parameter', example: '/prices?symbols=AAPL,MSFT,GOOG' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const symbols = symbolsParam.split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
  if (symbols.length === 0) {
    return new Response(
      JSON.stringify({ error: 'No valid symbols provided' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const prices: { [key: string]: PriceData | null } = {}

  for (const symbol of symbols) {
    prices[symbol] = await getPriceFromCache(symbol, env)
  }

  return new Response(JSON.stringify({ prices, timestamp: new Date().toISOString() }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

async function handleSinglePrice(
  symbol: string,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  const price = await getPriceFromCache(symbol, env)

  if (!price) {
    return new Response(
      JSON.stringify({ error: `No price data available for ${symbol}` }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  return new Response(JSON.stringify({ price, timestamp: new Date().toISOString() }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

async function getPriceFromCache(symbol: string, env: Env): Promise<PriceData | null> {
  const cacheKey = `price:${symbol}`
  const cached = await env.PRICE_CACHE.get(cacheKey)

  if (cached) {
    try {
      const entry: CacheEntry = JSON.parse(cached)
      return entry.price
    } catch {
      await env.PRICE_CACHE.delete(cacheKey)
    }
  }

  return null
}

async function fetchHotPrices(supabase: any, env: Env): Promise<void> {
  try {
    if (!isMarketHours()) {
      console.log('Market hours check: outside trading hours, skipping hot price fetch')
      return
    }

    const { data: hotSymbols, error } = await supabase
      .from('positions')
      .select('symbol')
      .gt('quantity', 0)

    if (error) {
      console.error('Failed to fetch hot symbols:', error)
      return
    }

    if (!hotSymbols || hotSymbols.length === 0) {
      console.log('No hot symbols to fetch')
      return
    }

    const symbols = [...new Set(hotSymbols.map((s: any) => s.symbol))]
    console.log(`Fetching prices for ${symbols.length} hot symbols:`, symbols)

    await fetchAndCachePrices(symbols, supabase, env, 'hot')
  } catch (error) {
    console.error('Error in fetchHotPrices:', error)
  }
}

async function fetchWarmPrices(supabase: any, env: Env): Promise<void> {
  try {
    if (!isMarketHours()) {
      console.log('Market hours check: outside trading hours, skipping warm price fetch')
      return
    }

    const { data: hotSymbols } = await supabase
      .from('positions')
      .select('symbol')
      .gt('quantity', 0)
    const hotSet = new Set((hotSymbols || []).map((s: any) => s.symbol))

    const { data: watchlistItems, error } = await supabase
      .from('watchlist_items')
      .select('symbol')

    if (error) {
      console.error('Failed to fetch watchlist items:', error)
      return
    }

    if (!watchlistItems || watchlistItems.length === 0) {
      console.log('No warm symbols to fetch')
      return
    }

    const warmSymbols = [...new Set(watchlistItems.map((w: any) => w.symbol))].filter(s => !hotSet.has(s))
    console.log(`Fetching prices for ${warmSymbols.length} warm symbols`)

    await fetchAndCachePrices(warmSymbols, supabase, env, 'warm')
  } catch (error) {
    console.error('Error in fetchWarmPrices:', error)
  }
}

async function fetchAndCachePrices(
  symbols: string[],
  supabase: any,
  env: Env,
  category: string
): Promise<void> {
  const batchSize = 10
  const batches = []

  for (let i = 0; i < symbols.length; i += batchSize) {
    batches.push(symbols.slice(i, i + batchSize))
  }

  for (const batch of batches) {
    const results = await Promise.allSettled(
      batch.map(symbol => fetchPriceWithFallback(symbol, env))
    )

    for (let i = 0; i < batch.length; i++) {
      const symbol = batch[i]
      const result = results[i]

      if (result.status === 'fulfilled' && result.value) {
        const price = result.value
        const cacheKey = `price:${symbol}`
        const cacheEntry: CacheEntry = {
          price,
          timestamp: Date.now(),
        }

        try {
          await env.PRICE_CACHE.put(cacheKey, JSON.stringify(cacheEntry), {
            expirationTtl: CACHE_TTL_SECONDS,
          })

          const { error: upsertError } = await supabase
            .from('company_data')
            .upsert(
              {
                symbol: price.symbol,
                exchange: price.exchange,
                current_price: price.price,
                price_change_pct: price.change_pct,
                trading_volume: price.volume,
                currency: price.currency,
                price_source: price.source,
                last_updated: new Date().toISOString(),
              },
              { onConflict: 'symbol' }
            )

          if (upsertError) {
            console.error(`Failed to upsert price for ${symbol}:`, upsertError)
          } else {
            console.log(`Successfully cached and stored price for ${symbol}: $${price.price}`)
          }
        } catch (error) {
          console.error(`Error processing price for ${symbol}:`, error)
        }
      } else if (result.status === 'rejected') {
        console.error(`Failed to fetch price for ${symbol}:`, result.reason)
        await logFailedFetch(supabase, symbol, 'price-fetch', result.reason)
      }
    }

    // Small delay between batches to avoid rate limiting
    if (batches.indexOf(batch) < batches.length - 1) {
      await sleep(200)
    }
  }
}

async function fetchPriceWithFallback(symbol: string, env: Env): Promise<PriceData | null> {
  // Try Twelve Data first (primary source)
  const twelveDataPrice = await fetchFromTwelveData(symbol, env)
  if (twelveDataPrice) {
    return twelveDataPrice
  }

  // Fallback to Finnhub
  const finnhubPrice = await fetchFromFinnhub(symbol, env)
  if (finnhubPrice) {
    return finnhubPrice
  }

  console.warn(`Could not fetch price for ${symbol} from any source`)
  return null
}

async function fetchFromTwelveData(symbol: string, env: Env): Promise<PriceData | null> {
  if (!env.TWELVE_DATA_API_KEY) {
    console.warn('TWELVE_DATA_API_KEY not configured')
    return null
  }

  if (!checkRateLimit('twelve-data', TWELVE_DATA_RATE_LIMIT)) {
    console.warn('Twelve Data rate limit exceeded, skipping')
    return null
  }

  try {
    const url = `https://api.twelvedata.com/quote?symbol=${symbol}&apikey=${env.TWELVE_DATA_API_KEY}`
    const response = await fetch(url)

    if (!response.ok) {
      console.error(`Twelve Data API error for ${symbol}:`, response.status)
      return null
    }

    const data: any = await response.json()

    if (data.status === 'error') {
      console.warn(`Twelve Data error for ${symbol}:`, data.message)
      return null
    }

    if (!data.close || !data.open) {
      console.warn(`Incomplete data from Twelve Data for ${symbol}`)
      return null
    }

    const changePercent = data.change_percent ? parseFloat(data.change_percent) : 0
    const volume = data.volume ? parseInt(data.volume) : 0

    return {
      symbol: symbol.toUpperCase(),
      price: parseFloat(data.close),
      change_pct: changePercent,
      volume,
      currency: 'USD',
      source: 'twelve-data',
      exchange: data.exchange || 'US',
      fetched_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + CACHE_TTL_SECONDS * 1000).toISOString(),
    }
  } catch (error) {
    console.error(`Twelve Data fetch error for ${symbol}:`, error)
    return null
  }
}

async function fetchFromFinnhub(symbol: string, env: Env): Promise<PriceData | null> {
  if (!env.FINNHUB_API_KEY) {
    console.warn('FINNHUB_API_KEY not configured')
    return null
  }

  if (!checkRateLimit('finnhub', FINNHUB_RATE_LIMIT)) {
    console.warn('Finnhub rate limit exceeded, skipping')
    return null
  }

  try {
    const url = `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${env.FINNHUB_API_KEY}`
    const response = await fetch(url)

    if (!response.ok) {
      console.error(`Finnhub API error for ${symbol}:`, response.status)
      return null
    }

    const data: any = await response.json()

    if (!data.c) {
      console.warn(`Incomplete data from Finnhub for ${symbol}`)
      return null
    }

    const changePercent = data.dp ? parseFloat(data.dp) : 0
    const volume = data.v ? parseInt(data.v) : 0

    return {
      symbol: symbol.toUpperCase(),
      price: parseFloat(data.c),
      change_pct: changePercent,
      volume,
      currency: 'USD',
      source: 'finnhub',
      exchange: 'US',
      fetched_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + CACHE_TTL_SECONDS * 1000).toISOString(),
    }
  } catch (error) {
    console.error(`Finnhub fetch error for ${symbol}:`, error)
    return null
  }
}

async function buildDailyHistory(supabase: any, env: Env): Promise<void> {
  try {
    console.log('Building daily price history...')

    // Get all current prices from cache or database
    const { data: prices, error } = await supabase
      .from('company_data')
      .select('symbol, current_price, trading_volume')
      .not('current_price', 'is', null)

    if (error) {
      console.error('Failed to fetch prices for history:', error)
      return
    }

    if (!prices || prices.length === 0) {
      console.log('No prices to archive in history')
      return
    }

    const today = new Date().toISOString().split('T')[0]
    const historyEntries = prices.map((p: any) => ({
      symbol: p.symbol,
      date: today,
      close_price: p.current_price,
      volume: p.trading_volume || 0,
    }))

    const { error: insertError } = await supabase
      .from('price_history')
      .upsert(historyEntries, { onConflict: 'symbol,date' })

    if (insertError) {
      console.error('Failed to insert price history:', insertError)
    } else {
      console.log(`Successfully archived ${historyEntries.length} price points to history`)
    }
  } catch (error) {
    console.error('Error in buildDailyHistory:', error)
  }
}

async function logFailedFetch(supabase: any, symbol: string, source: string, error: any): Promise<void> {
  try {
    const errorMsg = error instanceof Error ? error.message : String(error)
    await supabase.from('failed_fetches').insert({
      symbol,
      source,
      error: errorMsg,
      timestamp: new Date().toISOString(),
    })
  } catch (e) {
    console.error('Failed to log fetch error:', e)
  }
}

function isMarketHours(): boolean {
  // Simple market hours check (9 AM - 4 PM ET, Monday-Friday)
  const now = new Date()
  const utcHour = now.getUTCHours()
  const etHour = utcHour - 5 // EST (adjust for EDT if needed)
  const dayOfWeek = now.getUTCDay()

  const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5
  const isMarketOpen = etHour >= MARKET_HOURS_START && etHour < MARKET_HOURS_END

  return isWeekday && isMarketOpen
}

function checkRateLimit(service: string, limit: number): boolean {
  const now = Date.now()
  const key = `${service}:${Math.floor(now / 60000)}` // 1-minute window

  if (!requestCounts[key]) {
    requestCounts[key] = { count: 0, reset: now + 60000 }
  }

  if (now > requestCounts[key].reset) {
    requestCounts[key] = { count: 0, reset: now + 60000 }
  }

  if (requestCounts[key].count >= limit) {
    return false
  }

  requestCounts[key].count++
  return true
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
