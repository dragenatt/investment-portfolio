import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { validate } from '@/lib/api/validate'
import { recalculatePosition } from '@/lib/services/transaction'
import { UpdateTransactionSchema } from '@/lib/schemas/transaction'
import { apiHandler } from '@/lib/api/handler'
import { recordAudit, changeEntries, diffForAudit, describeTrade, positionChangeEntries } from '@/lib/services/audit'

/** The transaction and the position it belongs to, as they were before the change. */
const BEFORE_SELECT =
  'position_id, type, quantity, price, fees, currency, executed_at, notes, position:positions!inner(symbol, portfolio_id, quantity, avg_cost)'

type Before = {
  position_id: string
  type: string
  quantity: number
  price: number
  fees: number
  currency: string
  executed_at: string
  notes: string | null
  position: { symbol: string; portfolio_id: string; quantity: number; avg_cost: number }
}

async function deleteHandler(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  // Get transaction to find position_id before deleting
  const { data } = await supabase
    .from('transactions')
    .select(BEFORE_SELECT)
    .eq('id', id)
    .single()
  const txn = data as unknown as Before | null
  if (!txn) return error('Transaction not found', 404)

  // Delete transaction
  const { error: delErr } = await supabase.from('transactions').delete().eq('id', id)
  if (delErr) return error(delErr.message, 500)

  // Recalculate position from remaining transactions
  const { data: remaining } = await supabase
    .from('transactions')
    .select('type, quantity, price, fees')
    .eq('position_id', txn.position_id)
    .order('executed_at', { ascending: true })
    // Ties on executed_at (the modal records a date, not a time) replay in entry order.
    .order('created_at', { ascending: true })

  const recalc = recalculatePosition((remaining || []) as Array<{ type: 'buy' | 'sell' | 'dividend' | 'split'; quantity: number; price: number; fees: number }>)
  await supabase
    .from('positions')
    .update({ quantity: recalc.quantity, avg_cost: recalc.avg_cost })
    .eq('id', txn.position_id)

  const trade = describeTrade({ ...txn, symbol: txn.position.symbol })
  const scope = { userId: user.id, positionId: txn.position_id, portfolioId: txn.position.portfolio_id, symbol: txn.position.symbol }
  recordAudit(
    { userId: user.id, entityType: 'transaction', entityId: id, portfolioId: scope.portfolioId, label: trade, action: 'deleted', oldValue: trade },
    ...positionChangeEntries(scope, txn.position, recalc),
  )

  return success({ deleted: true })
}

async function putHandler(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  let body
  try { body = await req.json() } catch { return error('Invalid JSON', 400) }
  const result = await validate(UpdateTransactionSchema, body)
  if ('error' in result) return result.error

  // Get transaction to find position_id
  const { data } = await supabase
    .from('transactions')
    .select(BEFORE_SELECT)
    .eq('id', id)
    .single()
  const txn = data as unknown as Before | null
  if (!txn) return error('Transaction not found', 404)

  // Update transaction
  const { error: updateErr } = await supabase
    .from('transactions')
    .update(result.data)
    .eq('id', id)
  if (updateErr) return error(updateErr.message, 500)

  // Recalculate position from all transactions
  const { data: allTxns } = await supabase
    .from('transactions')
    .select('type, quantity, price, fees')
    .eq('position_id', txn.position_id)
    .order('executed_at', { ascending: true })
    // Ties on executed_at (the modal records a date, not a time) replay in entry order.
    .order('created_at', { ascending: true })

  const recalc = recalculatePosition(
    (allTxns || []) as Array<{ type: 'buy' | 'sell' | 'dividend' | 'split'; quantity: number; price: number; fees: number }>
  )
  await supabase
    .from('positions')
    .update({ quantity: recalc.quantity, avg_cost: recalc.avg_cost })
    .eq('id', txn.position_id)

  const edited = { ...txn, ...result.data }
  const scope = { userId: user.id, positionId: txn.position_id, portfolioId: txn.position.portfolio_id, symbol: txn.position.symbol }
  recordAudit(
    ...changeEntries(
      { userId: user.id, entityType: 'transaction', entityId: id, portfolioId: scope.portfolioId, label: describeTrade({ ...edited, symbol: scope.symbol }) },
      diffForAudit(txn, edited, Object.keys(result.data)),
    ),
    ...positionChangeEntries(scope, txn.position, recalc),
  )

  return success({ updated: true })
}

export const PUT = apiHandler(putHandler)
export const DELETE = apiHandler(deleteHandler)
