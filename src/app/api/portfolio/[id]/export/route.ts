import { createServerSupabase } from '@/lib/supabase/server'
import { error } from '@/lib/api/response'
import { getPortfolioDetail } from '@/lib/services/portfolio'
import { transactionsToCSV, positionsToCSV } from '@/lib/utils/export'
import type { ExportTransaction, ExportPosition } from '@/lib/utils/export'

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const { data: portfolio, error: dbError } = await getPortfolioDetail(supabase, id)
  if (dbError) return error(dbError.message, dbError.code === 'PGRST116' ? 404 : 500)
  if (!portfolio) return error('Portfolio not found', 404)

  const url = new URL(req.url)
  const format = url.searchParams.get('format') ?? 'json'

  if (format === 'csv_transactions') {
    // Flatten all transactions from all positions
    const transactions: ExportTransaction[] = (portfolio.positions ?? []).flatMap(
      (pos: { symbol: string; transactions?: ExportTransaction[] }) =>
        (pos.transactions ?? []).map((t: ExportTransaction) => ({
          ...t,
          symbol: pos.symbol,
        }))
    )

    // Sort by date descending
    transactions.sort((a, b) => new Date(b.executed_at).getTime() - new Date(a.executed_at).getTime())

    const csv = transactionsToCSV(transactions)
    const filename = `${portfolio.name ?? 'portafolio'}_transacciones.csv`

    return new Response('\uFEFF' + csv, {
      headers: {
        'Content-Type': 'text/csv;charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  }

  if (format === 'csv_positions') {
    const positions: ExportPosition[] = (portfolio.positions ?? []).map(
      (p: { symbol: string; quantity: number; avg_cost: number; currency?: string }) => ({
        symbol: p.symbol,
        quantity: p.quantity,
        avg_cost: p.avg_cost,
        currency: p.currency,
      })
    )

    const csv = positionsToCSV(positions)
    const filename = `${portfolio.name ?? 'portafolio'}_posiciones.csv`

    return new Response('\uFEFF' + csv, {
      headers: {
        'Content-Type': 'text/csv;charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  }

  if (format === 'json') {
    const filename = `${portfolio.name ?? 'portafolio'}_export.json`
    return new Response(JSON.stringify(portfolio, null, 2), {
      headers: {
        'Content-Type': 'application/json;charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  }

  return error('Formato no válido. Use: csv_transactions, csv_positions o json', 400)
}
