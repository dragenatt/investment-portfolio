import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { recalculatePosition } from '@/lib/services/transaction'

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  // Get transaction to find position_id before deleting
  const { data: txn } = await supabase
    .from('transactions')
    .select('position_id')
    .eq('id', id)
    .single()
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

  const recalc = recalculatePosition((remaining || []) as Array<{ type: 'buy' | 'sell' | 'dividend' | 'split'; quantity: number; price: number; fees: number }>)
  await supabase
    .from('positions')
    .update({ quantity: recalc.quantity, avg_cost: recalc.avg_cost })
    .eq('id', txn.position_id)

  return success({ deleted: true })
}
