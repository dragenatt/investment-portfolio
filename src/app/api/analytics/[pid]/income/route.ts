import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { withAuditedCache } from '@/lib/cache/with-cache'
import { buildResultMetadata } from '@/lib/services/result-metadata'
import { CACHE_KEYS } from '@/lib/cache/redis'
import { getIncomeAnalytics } from '@/lib/services/dividend-analytics'
import { apiHandler } from '@/lib/api/handler'

async function getHandler(_req: Request, { params }: { params: Promise<{ pid: string }> }) {
  const { pid } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const data = await withAuditedCache(`${CACHE_KEYS.ANALYTICS_INCOME}${user.id}:${pid}`, 600, async () => {
    const income = await getIncomeAnalytics(supabase, pid)
    return {
      ...income,
      _meta: buildResultMetadata({
        model: 'income',
        data: { description: 'Operaciones de tipo dividendo registradas en el portafolio', symbols: [], priceSource: 'none' },
        period: {
          from: income.monthly_history[0] ? `${income.monthly_history[0].month}-01` : null,
          to: new Date().toISOString().slice(0, 10),
          observations: income.monthly_history.length,
          cadence: 'mensual',
        },
        assumptions: [
          { name: 'Dividendos', value: 'Solo los que se registraron como operación; nada se estima', source: 'dividend-analytics.ts' },
          { name: 'Rendimiento por dividendos', value: 'Dividendos de los últimos 12 meses sobre el valor actual de las posiciones (cotización guardada o costo)', source: 'dividend-analytics.ts' },
          { name: 'Moneda', value: `Montos en ${income.currency}: cada dividendo al tipo de cambio del día en que se pagó, el valor de las posiciones al de hoy`, source: 'dividend-analytics.ts' },
        ],
      }),
    }
  })
  return success(data)
}

export const GET = apiHandler(getHandler)
