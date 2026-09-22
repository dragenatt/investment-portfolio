import { after } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { error } from '@/lib/api/response'
import { getBatchQuotes } from '@/lib/services/market'
import { NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api/handler'
import { serviceRoleClient } from '@/lib/supabase/admin'
import { MAX_FILTER_SYMBOLS, symbolChunks } from '@/lib/services/live-prices'
import { publishQuotes } from '@/lib/services/quote-store'

async function getHandler(req: Request) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const url = new URL(req.url)
  const symbolsParam = url.searchParams.get('symbols')
  if (!symbolsParam) return error('symbols required', 400)

  // Every symbol asked for, in provider-sized batches. This used to keep the
  // first twenty and drop the rest without saying so, so a book with more
  // holdings than that showed no live price for the remainder — and their
  // stored quote never refreshed, because this route is what writes it. The
  // ceiling is the one Realtime's filter has: beyond it a client would not
  // receive the pushes anyway.
  const symbols = [...new Set(symbolsParam.split(',').map((s) => s.trim()).filter(Boolean))].slice(0, MAX_FILTER_SYMBOLS)
  const batches = await Promise.all(symbolChunks(symbols).map((chunk) => getBatchQuotes(chunk)))
  const results = Object.assign({}, ...batches) as Awaited<ReturnType<typeof getBatchQuotes>>

  // Publish what moved (C2). Writing to current_prices is what Realtime streams
  // to every client watching these symbols, so one tab's refresh updates every
  // other screen. Only changed rows are written — an identical price would be
  // broadcast as a change — and it runs after the response, so streaming never
  // slows the quotes this request came for.
  after(async () => {
    const writer = serviceRoleClient()
    if (writer) await publishQuotes(writer, results)
  })

  // Not in a shared cache. `s-maxage=30, stale-while-revalidate=60` let the
  // CDN answer a screen polling every LIVE_POLL_MS with a copy up to ninety
  // seconds old, and answer it without running the session check. How often a
  // provider is asked is the quote cache's job (LIVE_QUOTE_TTL_MS), not the CDN's.
  const res = NextResponse.json({ data: results, error: null }, { status: 200 })
  res.headers.set('Cache-Control', 'private, no-store')
  return res
}

export const GET = apiHandler(getHandler)
