import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { withAuditedCache } from '@/lib/cache/with-cache'
import { apiHandler } from '@/lib/api/handler'
import { loadRiskInputs, riskInputsMetadata } from '@/lib/jobs/kinds/risk-inputs'
import { analyseRiskSources, MIN_RISK_OBSERVATIONS } from '@/lib/services/risk-sources'

// The true sources of the portfolio's risk (P2-5): by holding, sector, factor,
// principal component and market, every view decomposing the same variance on
// the same aligned window. See src/lib/services/risk-sources.ts.

async function getHandler(_req: Request, { params }: { params: Promise<{ pid: string }> }) {
  const { pid } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const data = await withAuditedCache(`analytics:risk-sources:${user.id}:${pid}`, 1800, async () => {
    const inputs = await loadRiskInputs(supabase, pid)
    if ('message' in inputs) return { message: inputs.message }
    const { common, aligned, cadence, sectors, benchmark } = inputs

    const sources = analyseRiskSources({
      symbols: common.symbols,
      weights: common.currentWeights,
      returnsMatrix: aligned.returnsMatrix,
      periodsPerYear: cadence.periodsPerYear,
      sectors,
      benchmark: aligned.benchmarkReturns ? { ...benchmark, returns: aligned.benchmarkReturns } : null,
      factors: aligned.factors,
    })

    if (!sources) {
      return { message: `No hay suficiente historial en común para medir las fuentes de riesgo (se necesitan ${MIN_RISK_OBSERVATIONS} periodos).` }
    }

    return {
      ...sources,
      window: {
        from: common.commonDates[0],
        to: common.lastDate,
        intervals_used: aligned.intervalsUsed,
        intervals_available: aligned.intervalsAvailable,
        cadence: cadence.label,
      },
      excluded_symbols: inputs.excludedSymbols,
      omitted: aligned.omitted,
      benchmark,
      _meta: riskInputsMetadata(inputs, 'riskSources', {
        usesRiskFree: !!aligned.factors,
        assumptions: [
          { name: 'Descomposición', value: 'Euler por activo, PCA, regresión de factores y beta; todas sobre la misma varianza', source: 'risk-sources.ts' },
          { name: 'Factores', value: 'Aproximaciones con ETF a los factores de Fama-French', source: 'factors.ts (construcción etf-proxy-v1)' },
          { name: 'Cobertura mínima de una serie opcional', value: '95% de los periodos', source: 'Convención (risk-sources.ts)' },
        ],
      }),
    }
  })

  return success(data)
}

export const GET = apiHandler(getHandler)
