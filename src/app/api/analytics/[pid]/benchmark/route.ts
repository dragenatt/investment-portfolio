import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { getHistory } from '@/lib/services/market'
import { apiHandler } from '@/lib/api/handler'
import { buildResultMetadata } from '@/lib/services/result-metadata'

async function getHandler(req: Request, { params }: { params: Promise<{ pid: string }> }) {
  const { pid } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const url = new URL(req.url)
  const vs = url.searchParams.get('vs') || 'SPY'
  const benchmarks = vs.split(',').slice(0, 3)

  const results: Record<string, Array<{ date: string; value: number }>> = {}

  for (const symbol of benchmarks) {
    const history = await getHistory(symbol.trim(), '1y')
    if (history.length > 0) {
      const base = history[0].close
      results[symbol.trim()] = history.map((h: { date: string; close: number }) => ({
        date: h.date,
        value: ((h.close - base) / base) * 100,
      }))
    }
  }

  const series = Object.values(results)
  return success({
    ...results,
    _meta: buildResultMetadata({
      model: 'benchmark',
      data: { description: 'Historial de precios de los índices pedidos, consultado al proveedor', symbols: Object.keys(results), priceSource: series.length > 0 ? 'provider' : 'none' },
      period: { from: series[0]?.[0]?.date ?? null, to: series[0]?.[series[0].length - 1]?.date ?? null, observations: series[0]?.length ?? null, cadence: 'semanal' },
      assumptions: [{ name: 'Normalización', value: 'Cambio porcentual desde el primer cierre del año', source: 'benchmark route' }],
    }),
  })
}

export const GET = apiHandler(getHandler)
