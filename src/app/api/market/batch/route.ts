import { after } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { error } from '@/lib/api/response'
import { getBatchQuotes } from '@/lib/services/market'
import { NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api/handler'
import { serviceRoleClient } from '@/lib/supabase/admin'
import { quotesToPriceRows, changedRows, type StoredPrice } from '@/lib/services/live-prices'

async function getHandler(req: Request) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const url = new URL(req.url)
  const symbolsParam = url.searchParams.get('symbols')
  if (!symbolsParam) return error('symbols required', 400)

  const symbols = symbolsParam.split(',').slice(0, 20)
  const results = await getBatchQuotes(symbols)

  // Publish what moved (C2). Writing to current_prices is what Realtime streams
  // to every client watching these symbols, so one tab's refresh updates every
  // other screen. Only changed rows are written — an identical price would be
  // broadcast as a change — and it runs after the response, so streaming never
  // slows the quotes this request came for.
  after(async () => {
    const writer = serviceRoleClient()
    if (!writer) return
    const now = Date.now()
    const rows = quotesToPriceRows(results, now)
    if (rows.length === 0) return
    const { data: stored } = await writer
      .from('current_prices')
      .select('symbol, exchange, price, change_pct, expires_at')
      .in('symbol', rows.map((r) => r.symbol))
    const toWrite = changedRows(rows, (stored ?? []) as StoredPrice[], now)
    if (toWrite.length === 0) return
    const { error: writeError } = await writer
      .from('current_prices')
      .upsert(toWrite, { onConflict: 'symbol,exchange' })
    if (writeError) console.warn('[market/batch] no se pudieron publicar precios', writeError.message)
  })

  // Cache-Control: serve cached for 30s, allow stale for 60s while revalidating
  const res = NextResponse.json({ data: results, error: null }, { status: 200 })
  res.headers.set('Cache-Control', 's-maxage=30, stale-while-revalidate=60')
  return res
}

export const GET = apiHandler(getHandler)
