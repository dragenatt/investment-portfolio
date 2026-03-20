import { createClient } from '@supabase/supabase-js'

export interface Env {
  PRICE_CACHE: KVNamespace
  SUPABASE_URL: string
  SUPABASE_SERVICE_ROLE_KEY: string
  ALPHA_VANTAGE_API_KEY: string
  BANXICO_TOKEN: string
  COINGECKO_API_KEY?: string
}

export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

    switch (event.cron) {
      case '*/5 * * * *':
        // Fetch hot symbols (open positions) + crypto
        ctx.waitUntil(fetchHotPrices(supabase, env))
        ctx.waitUntil(fetchCryptoPrices(supabase, env))
        break
      case '*/30 * * * *':
        // Fetch warm symbols (watchlists, not already hot)
        ctx.waitUntil(fetchWarmPrices(supabase, env))
        break
      case '0 */12 * * *':
        // Fetch Banxico data (exchange rates)
        ctx.waitUntil(fetchBanxico(supabase, env))
        break
      case '0 22 * * 1-5':
        // Build daily history from current prices
        ctx.waitUntil(buildHistory(supabase, env))
        break
    }
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    return new Response('Price Engine Worker is running', { status: 200 })
  },
}

async function fetchHotPrices(supabase: ReturnType<typeof createClient>, env: Env) {
  // 1. Get hot symbols (positions with quantity > 0)
  const { data: hotSymbols } = await supabase
    .from('positions')
    .select('symbol')
    .gt('quantity', 0)

  if (!hotSymbols || hotSymbols.length === 0) return

  const symbols = [...new Set(hotSymbols.map(s => s.symbol))]

  // 2. Fetch from Yahoo Finance in batches
  for (const symbol of symbols) {
    try {
      const cached = await env.PRICE_CACHE.get(`price:${symbol}`)
      if (cached) continue // Still fresh

      const res = await fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`
      )
      if (!res.ok) continue
      const data = await res.json() as Record<string, unknown>
      const chart = data.chart as Record<string, unknown> | undefined
      const results = chart?.result as Array<Record<string, unknown>> | undefined
      const meta = results?.[0]?.meta as Record<string, unknown> | undefined
      if (!meta) continue

      const price = {
        symbol: meta.symbol,
        exchange: meta.exchangeName || 'US',
        price: meta.regularMarketPrice,
        change_pct: ((meta.regularMarketPrice as number) - (meta.previousClose as number)) / (meta.previousClose as number) * 100,
        volume: meta.regularMarketVolume || 0,
        currency: meta.currency || 'USD',
        source: 'yahoo',
        fetched_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      }

      // Write to KV (5 min TTL)
      await env.PRICE_CACHE.put(`price:${symbol}`, JSON.stringify(price), { expirationTtl: 300 })

      // Write to Supabase
      await supabase
        .from('current_prices')
        .upsert(price, { onConflict: 'symbol,exchange' })

      // Check alerts for this symbol
      const { data: alerts } = await supabase
        .from('alerts')
        .select('*')
        .eq('symbol', symbol)
        .eq('is_active', true)

      if (alerts) {
        for (const alert of alerts) {
          let triggered = false
          if (alert.condition === 'above' && (price.price as number) >= alert.target_value) triggered = true
          if (alert.condition === 'below' && (price.price as number) <= alert.target_value) triggered = true
          if (alert.condition === 'pct_change_daily' && Math.abs(price.change_pct) >= alert.target_value) triggered = true

          if (triggered) {
            await supabase
              .from('alerts')
              .update({ triggered_at: new Date().toISOString(), is_active: false })
              .eq('id', alert.id)
          }
        }
      }
    } catch (e) {
      // Log failed fetch
      await supabase.from('failed_fetches').insert({
        symbol, source: 'yahoo', error: String(e),
      })
    }
  }
}

async function fetchWarmPrices(supabase: ReturnType<typeof createClient>, env: Env) {
  // Get hot symbols to exclude
  const { data: hotSymbols } = await supabase
    .from('positions')
    .select('symbol')
    .gt('quantity', 0)
  const hotSet = new Set((hotSymbols || []).map(s => s.symbol))

  // Get warm symbols (in watchlists but not in positions)
  const { data: watchlistItems } = await supabase
    .from('watchlist_items')
    .select('symbol')
  if (!watchlistItems) return

  const warmSymbols = [...new Set(watchlistItems.map(w => w.symbol))].filter(s => !hotSet.has(s))

  for (const symbol of warmSymbols) {
    try {
      const cached = await env.PRICE_CACHE.get(`price:${symbol}`)
      if (cached) continue

      const res = await fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`
      )
      if (!res.ok) continue
      const data = await res.json() as Record<string, unknown>
      const chart = data.chart as Record<string, unknown> | undefined
      const results = chart?.result as Array<Record<string, unknown>> | undefined
      const meta = results?.[0]?.meta as Record<string, unknown> | undefined
      if (!meta) continue

      const price = {
        symbol: meta.symbol,
        exchange: meta.exchangeName || 'US',
        price: meta.regularMarketPrice,
        change_pct: ((meta.regularMarketPrice as number) - (meta.previousClose as number)) / (meta.previousClose as number) * 100,
        volume: meta.regularMarketVolume || 0,
        currency: meta.currency || 'USD',
        source: 'yahoo',
        fetched_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      }

      await env.PRICE_CACHE.put(`price:${symbol}`, JSON.stringify(price), { expirationTtl: 1800 })
      await supabase.from('current_prices').upsert(price, { onConflict: 'symbol,exchange' })
    } catch (e) {
      await supabase.from('failed_fetches').insert({ symbol, source: 'yahoo', error: String(e) })
    }
  }
}

async function fetchCryptoPrices(supabase: ReturnType<typeof createClient>, env: Env) {
  // Get crypto symbols from positions and watchlists
  const { data: cryptoPositions } = await supabase
    .from('positions')
    .select('symbol')
    .eq('asset_type', 'crypto')
    .gt('quantity', 0)

  if (!cryptoPositions || cryptoPositions.length === 0) return

  const symbols = [...new Set(cryptoPositions.map(s => s.symbol.toLowerCase()))]

  try {
    // CoinGecko supports comma-separated ids
    const ids = symbols.join(',')
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true`
    )
    if (!res.ok) return
    const data = await res.json() as Record<string, Record<string, number>>

    for (const [id, info] of Object.entries(data)) {
      const symbol = id.toUpperCase()
      const price = {
        symbol,
        exchange: 'CRYPTO',
        price: info.usd,
        change_pct: info.usd_24h_change || 0,
        volume: Math.round(info.usd_24h_vol || 0),
        currency: 'USD',
        source: 'coingecko',
        fetched_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      }

      await env.PRICE_CACHE.put(`price:${symbol}`, JSON.stringify(price), { expirationTtl: 300 })
      await supabase.from('current_prices').upsert(price, { onConflict: 'symbol,exchange' })
    }
  } catch (e) {
    await supabase.from('failed_fetches').insert({ symbol: 'CRYPTO_BATCH', source: 'coingecko', error: String(e) })
  }
}

async function fetchBanxico(supabase: ReturnType<typeof createClient>, env: Env) {
  try {
    // Fetch USD/MXN exchange rate from Banxico
    const res = await fetch('https://www.banxico.org.mx/SieAPIRest/service/v1/series/SF43718/datos/oportuno', {
      headers: { 'Bmx-Token': env.BANXICO_TOKEN },
    })
    if (!res.ok) return
    const data = await res.json() as Record<string, unknown>
    const bmx = data?.bmx as Record<string, unknown> | undefined
    const series = bmx?.series as Array<Record<string, unknown>> | undefined
    const datos = series?.[0]?.datos as Array<Record<string, unknown>> | undefined
    const rate = datos?.[0]?.dato as string | undefined
    if (!rate) return

    await env.PRICE_CACHE.put('fx:USDMXN', rate, { expirationTtl: 43200 })
  } catch (e) {
    await supabase.from('failed_fetches').insert({
      symbol: 'USDMXN', source: 'banxico', error: String(e),
    })
  }
}

async function buildHistory(supabase: ReturnType<typeof createClient>, env: Env) {
  // Get all current prices and insert into history
  const { data: prices } = await supabase.from('current_prices').select('*')
  if (!prices) return

  const today = new Date().toISOString().split('T')[0]

  for (const p of prices) {
    await supabase.from('price_history').upsert({
      symbol: p.symbol,
      exchange: p.exchange,
      date: today,
      close: p.price,
      volume: p.volume,
    }, { onConflict: 'symbol,exchange,date' })
  }
}
