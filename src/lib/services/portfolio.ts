import { type SupabaseClient } from '@supabase/supabase-js'

export async function getUserPortfolios(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from('portfolios')
    .select(`
      *,
      positions (
        id, symbol, asset_type, quantity, avg_cost, currency
      )
    `)
    .eq('user_id', userId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })

  return { data, error }
}

export async function getPortfolioDetail(supabase: SupabaseClient, portfolioId: string) {
  const { data, error } = await supabase
    .from('portfolios')
    .select(`
      *,
      positions (
        id, symbol, asset_type, quantity, avg_cost, currency, opened_at,
        transactions (id, type, quantity, price, fees, currency, executed_at, notes, created_at)
      )
    `)
    .eq('id', portfolioId)
    .is('deleted_at', null)
    .single()

  return { data, error }
}
