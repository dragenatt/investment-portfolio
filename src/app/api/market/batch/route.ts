import { createServerSupabase } from '@/lib/supabase/server'
import { error } from '@/lib/api/response'
import { getBatchQuotes } from '@/lib/services/market'
import { NextResponse } from 'next/server'

export async function GET(req: Request) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const url = new URL(req.url)
  const symbolsParam = url.searchParams.get('symbols')
  if (!symbolsParam) return error('symbols required', 400)

  const symbols = symbolsParam.split(',').slice(0, 20)
  const results = await getBatchQuotes(symbols)

  // Cache-Control: serve cached for 30s, allow stale for 60s while revalidating
  const res = NextResponse.json({ data: results, error: null }, { status: 200 })
  res.headers.set('Cache-Control', 's-maxage=30, stale-while-revalidate=60')
  return res
}
