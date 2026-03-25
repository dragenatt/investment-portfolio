import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { getQuote } from '@/lib/services/market'

export async function GET(req: Request) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const url = new URL(req.url)
  const symbolsParam = url.searchParams.get('symbols')
  if (!symbolsParam) return error('symbols required', 400)

  const symbols = symbolsParam.split(',').slice(0, 20)
  const results: Record<string, { price: number | null; change: number | null; changePct: number | null; currency: string }> = {}

  await Promise.all(
    symbols.map(async (symbol) => {
      try {
        const quote = await getQuote(symbol.trim())
        if (quote) {
          results[quote.symbol] = {
            price: quote.price,
            change: quote.change,
            changePct: quote.changePct,
            currency: quote.currency,
          }
        }
      } catch {
        // skip failed quotes
      }
    })
  )

  return success(results)
}
