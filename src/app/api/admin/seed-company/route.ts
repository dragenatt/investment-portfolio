import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'

export async function POST(req: Request) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const body = await req.json()
  const { symbol, ...rest } = body

  if (!symbol) return error('symbol required', 400)

  const expires_at = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

  const { data, error: dbError } = await supabase
    .from('company_data')
    .upsert({
      symbol: symbol.toUpperCase(),
      ...rest,
      fetched_at: new Date().toISOString(),
      expires_at,
    }, { onConflict: 'symbol' })
    .select()
    .single()

  if (dbError) return error(dbError.message, 500)
  return success(data)
}
