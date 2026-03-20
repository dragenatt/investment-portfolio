import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { validate } from '@/lib/api/validate'
import { CreateTransactionSchema } from '@/lib/schemas/transaction'
import { recalculatePosition } from '@/lib/services/transaction'

export async function GET(req: Request) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const url = new URL(req.url)
  const pid = url.searchParams.get('pid')
  if (!pid) return error('portfolio_id (pid) required', 400)

  const { data, error: dbError } = await supabase
    .from('transactions')
    .select('*, position:positions!inner(portfolio_id, symbol)')
    .eq('position.portfolio_id', pid)
    .order('executed_at', { ascending: false })

  if (dbError) return error(dbError.message, 500)
  return success(data)
}

export async function POST(req: Request) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const body = await req.json()
  const result = await validate(CreateTransactionSchema, body)
  if ('error' in result) return result.error

  const txn = result.data

  // Verify portfolio ownership (RLS handles this too, but we need the portfolio_id check)
  const { data: portfolio } = await supabase
    .from('portfolios')
    .select('id')
    .eq('id', txn.portfolio_id)
    .single()
  if (!portfolio) return error('Portfolio not found', 404)

  // Find or create position
  let { data: position } = await supabase
    .from('positions')
    .select('id, quantity')
    .eq('portfolio_id', txn.portfolio_id)
    .eq('symbol', txn.symbol)
    .single()

  if (!position) {
    if (txn.type !== 'buy') return error('Cannot sell/split/dividend without existing position', 400)
    const { data: newPos, error: posErr } = await supabase
      .from('positions')
      .insert({
        portfolio_id: txn.portfolio_id,
        symbol: txn.symbol,
        asset_type: txn.asset_type,
        quantity: 0,
        avg_cost: 0,
        currency: txn.currency,
      })
      .select()
      .single()
    if (posErr) return error(posErr.message, 500)
    position = newPos
  }

  if (!position) return error('Failed to resolve position', 500)

  // Validate sell quantity
  if (txn.type === 'sell' && txn.quantity > position.quantity) {
    return error(`Cannot sell ${txn.quantity} — only ${position.quantity} held`, 400)
  }

  // Insert transaction
  const { data: savedTxn, error: txnErr } = await supabase
    .from('transactions')
    .insert({
      position_id: position.id,
      type: txn.type,
      quantity: txn.quantity,
      price: txn.price,
      fees: txn.fees,
      currency: txn.currency,
      executed_at: txn.executed_at,
      notes: txn.notes,
    })
    .select()
    .single()
  if (txnErr) return error(txnErr.message, 500)

  // Recalculate position from all transactions
  const { data: allTxns } = await supabase
    .from('transactions')
    .select('type, quantity, price, fees')
    .eq('position_id', position.id)
    .order('executed_at', { ascending: true })

  if (allTxns) {
    const recalc = recalculatePosition(allTxns as Array<{ type: 'buy' | 'sell' | 'dividend' | 'split'; quantity: number; price: number; fees: number }>)
    await supabase
      .from('positions')
      .update({ quantity: recalc.quantity, avg_cost: recalc.avg_cost })
      .eq('id', position.id)
  }

  return success(savedTxn, undefined, 201)
}
