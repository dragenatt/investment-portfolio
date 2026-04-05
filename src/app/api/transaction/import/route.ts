import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { rateLimit } from '@/lib/api/rate-limit'
import { recalculatePosition } from '@/lib/services/transaction'
import { z } from 'zod'

const ASSET_TYPES = ['stock', 'etf', 'crypto', 'bond', 'forex', 'commodity'] as const

/** Auto-detect asset type from symbol pattern */
function inferAssetType(symbol: string): typeof ASSET_TYPES[number] {
  if (symbol.startsWith('^')) return 'etf'
  if (symbol.endsWith('.X') || symbol.includes('-USD')) return 'crypto'
  if (symbol.endsWith('=F')) return 'commodity'
  if (symbol.endsWith('=X')) return 'forex'
  return 'stock'
}

const ImportRowSchema = z.object({
  date: z.string(),
  symbol: z.string().max(20).regex(/^[A-Z0-9.\-:=^]+$/),
  type: z.enum(['buy', 'sell', 'dividend']),
  quantity: z.number().positive().max(999_999_999),
  price: z.number().positive().max(999_999_999),
  fees: z.number().min(0).default(0),
  currency: z.enum(['MXN', 'USD', 'EUR']),
  notes: z.string().max(500).optional(),
  asset_type: z.enum(ASSET_TYPES).optional(),
})

const ImportBodySchema = z.object({
  portfolio_id: z.string().uuid(),
  asset_type: z.enum(['stock', 'etf', 'crypto', 'bond', 'forex', 'commodity']).default('stock'),
  rows: z.array(ImportRowSchema).min(1).max(500),
})

export async function POST(req: Request) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const allowed = await rateLimit(user.id, 'transaction')
  if (!allowed) return error('Demasiadas solicitudes, intenta más tarde', 429)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return error('Invalid JSON', 400)
  }

  const parsed = ImportBodySchema.safeParse(body)
  if (!parsed.success) {
    const messages = parsed.error.issues.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')
    return error(messages, 400)
  }

  const { portfolio_id, asset_type, rows } = parsed.data

  // Verify portfolio ownership
  const { data: portfolio } = await supabase
    .from('portfolios')
    .select('id')
    .eq('id', portfolio_id)
    .single()
  if (!portfolio) return error('Portfolio not found', 404)

  const errors: string[] = []
  let imported = 0

  // Group rows by symbol to batch position lookups
  const bySymbol = new Map<string, typeof rows>()
  for (const row of rows) {
    const existing = bySymbol.get(row.symbol) ?? []
    existing.push(row)
    bySymbol.set(row.symbol, existing)
  }

  for (const [symbol, symbolRows] of bySymbol) {
    // Find or create position for this symbol
    let { data: position } = await supabase
      .from('positions')
      .select('id, quantity')
      .eq('portfolio_id', portfolio_id)
      .eq('symbol', symbol)
      .single()

    // Check if first transaction for this symbol is a buy (if no position exists)
    const sortedRows = [...symbolRows].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    )

    if (!position) {
      const firstRow = sortedRows[0]
      if (firstRow.type !== 'buy') {
        errors.push(`${symbol}: la primera transaccion debe ser una compra (no se puede vender/dividendo sin posicion existente)`)
        continue
      }

      // Use row-level asset_type, then request-level, then auto-detect from symbol
      const resolvedType = firstRow.asset_type ?? asset_type ?? inferAssetType(symbol)
      const { data: newPos, error: posErr } = await supabase
        .from('positions')
        .insert({
          portfolio_id,
          symbol,
          asset_type: resolvedType,
          quantity: 0,
          avg_cost: 0,
          currency: firstRow.currency,
        })
        .select()
        .single()

      if (posErr) {
        errors.push(`${symbol}: error al crear posicion — ${posErr.message}`)
        continue
      }
      position = newPos
    }

    if (!position) {
      errors.push(`${symbol}: no se pudo resolver la posicion`)
      continue
    }

    // Insert all transactions for this symbol
    for (const row of sortedRows) {
      const { error: txnErr } = await supabase
        .from('transactions')
        .insert({
          position_id: position.id,
          type: row.type,
          quantity: row.quantity,
          price: row.price,
          fees: row.fees,
          currency: row.currency,
          executed_at: row.date,
          notes: row.notes,
        })

      if (txnErr) {
        errors.push(`${symbol} (${row.date}): ${txnErr.message}`)
      } else {
        imported++
      }
    }

    // Recalculate position from all transactions
    const { data: allTxns } = await supabase
      .from('transactions')
      .select('type, quantity, price, fees')
      .eq('position_id', position.id)
      .order('executed_at', { ascending: true })

    if (allTxns) {
      const recalc = recalculatePosition(
        allTxns as Array<{
          type: 'buy' | 'sell' | 'dividend' | 'split'
          quantity: number
          price: number
          fees: number
        }>
      )
      await supabase
        .from('positions')
        .update({ quantity: recalc.quantity, avg_cost: recalc.avg_cost })
        .eq('id', position.id)
    }
  }

  return success({ imported, errors })
}
