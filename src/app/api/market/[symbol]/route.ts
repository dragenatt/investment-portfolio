import { createServerSupabase } from '@/lib/supabase/server'
import { error } from '@/lib/api/response'
import { getQuote } from '@/lib/services/market'
import { NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api/handler'

/**
 * The quote for one symbol — the asset page's header.
 *
 * It used to answer from current_prices when the stored row had not expired,
 * behind a five-minute Redis cache. That row is the table's shape, not a
 * quote's: `change_pct` instead of `change` and `changePct`, and no name. A
 * symbol any dashboard had just polled — every holding — came back that way,
 * and its page read "$0.00 USD (--)" for the day while it moved 1.6%. The row
 * could also be five minutes old.
 *
 * getQuote is the same source /api/market/batch uses: a quote reused for
 * LIVE_QUOTE_TTL_MS, then asked of the providers, always in one shape.
 */
async function getHandler(_req: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const quote = await getQuote(symbol)
  if (!quote) return error('Symbol not found', 404)

  // Not in a shared cache, for the reasons given in /api/market/batch.
  const res = NextResponse.json({ data: quote, error: null }, { status: 200 })
  res.headers.set('Cache-Control', 'private, no-store')
  return res
}

export const GET = apiHandler(getHandler)
