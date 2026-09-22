import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { rateLimit } from '@/lib/api/rate-limit'
import { apiHandler } from '@/lib/api/handler'
import { getQuote } from '@/lib/services/market'
import { recordAudit } from '@/lib/services/audit'

/**
 * PATCH /api/portfolio/[id]/positions/[positionId] — correct a position's
 * symbol.
 *
 * Six holdings in production were imported under symbols no provider knows
 * (FEMSAUBD for FEMSAUBD.MX among them) and have been valued at cost ever
 * since. A position's symbol could not be changed: the only fix was deleting
 * the position and entering every trade again.
 *
 * The new symbol has to price — correcting one unknown symbol to another would
 * fix nothing — and must not already be a position in the same portfolio,
 * which the (portfolio_id, symbol) constraint forbids anyway. Merging two
 * positions is a different operation and is not done here. The trades stay
 * where they are: they belong to the position, not to the symbol.
 */

const BodySchema = z.object({
  symbol: z.string().trim().toUpperCase().pipe(z.string().min(1).max(20).regex(/^[A-Z0-9.\-:=^]+$/)),
})

type Params = { params: Promise<{ id: string; positionId: string }> }

export const PATCH = apiHandler(async (req: Request, ctx) => {
  const { id: portfolioId, positionId } = await (ctx as Params).params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const allowed = await rateLimit(user.id, 'transaction')
  if (!allowed) return error('Demasiadas solicitudes, intenta más tarde', 429)

  const parsed = BodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return error('Símbolo no válido', 400)
  const symbol = parsed.data.symbol

  // Read through the owner's session: row-level security only shows positions
  // in the reader's own portfolios.
  const { data: position } = await supabase
    .from('positions')
    .select('id, symbol, portfolio_id')
    .eq('id', positionId)
    .eq('portfolio_id', portfolioId)
    .maybeSingle()
  if (!position) return error('Posición no encontrada', 404)
  if (position.symbol === symbol) return success({ id: position.id, symbol, changed: false })

  const { data: clash } = await supabase
    .from('positions')
    .select('id')
    .eq('portfolio_id', portfolioId)
    .eq('symbol', symbol)
    .maybeSingle()
  if (clash) {
    return error(`Ya tienes una posición en ${symbol} en este portafolio. Registra ahí las operaciones de ${position.symbol}.`, 409)
  }

  const quote = await getQuote(symbol)
  if (!quote || quote.price == null) {
    return error(`Ningún proveedor de precios reconoce ${symbol}. Revisa cómo está escrito, por ejemplo con el sufijo .MX para la BMV.`, 422)
  }

  const { error: updateError } = await supabase.from('positions').update({ symbol }).eq('id', positionId)
  if (updateError) return error('No se pudo cambiar el símbolo', 500)

  recordAudit({
    userId: user.id,
    entityType: 'position',
    entityId: positionId,
    portfolioId,
    label: symbol,
    action: 'updated',
    field: 'symbol',
    oldValue: position.symbol,
    newValue: symbol,
  })

  return success({ id: positionId, symbol, changed: true, price: quote.price, currency: quote.currency })
})
