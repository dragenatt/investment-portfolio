import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { withAuditedCache } from '@/lib/cache/with-cache'
import { apiHandler } from '@/lib/api/handler'
import { loadRiskInputs, riskInputsMetadata } from '@/lib/jobs/kinds/risk-inputs'
import { calculateCovarianceMatrix } from '@/lib/services/covariance'
import { historicalExpectedReturns, efficientFrontier } from '@/lib/services/optimizer'
import { minimiseCVaRWeights, riskParityWeights } from '@/lib/services/allocation-strategies'
import { DEFAULT_COST_MODEL, costModelFrom, isCostModelConfigured, describeCostModel } from '@/lib/services/costs'
import {
  estimateReliability,
  parsePortfolioScenarioRequest,
  REQUEST_SIMULATIONS,
  runScenario,
  scenarioFromWeights,
  type AllocationPreset,
} from '@/lib/services/scenario-engine'
import { COMMON_ASSUMPTIONS } from '@/lib/services/result-metadata'
import { TRADING_DAYS_PER_YEAR } from '@/lib/constants/financial-constants'

// The scenario engine (P2-9) run on this portfolio: its holdings and history,
// with the allocation, contributions, horizon, rebalancing, costs, inflation
// and shock the request asks for. The same request always returns the same
// result; the response carries the scenario key and seed that make it so.

const PRESET_NAMES: Record<AllocationPreset, string> = {
  current: 'Pesos actuales',
  equalWeight: 'Pesos iguales',
  riskParity: 'Paridad de riesgo',
  minCVaR: 'Mínimo CVaR',
  markowitz: 'Markowitz (máximo Sharpe)',
}

async function getHandler(req: Request, { params }: { params: Promise<{ pid: string }> }) {
  const { pid } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const request = parsePortfolioScenarioRequest(new URL(req.url).searchParams)
  // The costs the user stated for this portfolio (4.6) apply unless the request
  // names its own. Part of the cache key, so saving new costs is not answered
  // with a projection computed on the old ones.
  const { data: portfolioRow } = await supabase.from('portfolios').select('cost_model').eq('id', pid).maybeSingle()
  const storedCosts = costModelFrom(portfolioRow?.cost_model)
  const cacheKey = `analytics:scenario-engine:${user.id}:${pid}:${JSON.stringify(request)}:${JSON.stringify(storedCosts)}`

  const data = await withAuditedCache(cacheKey, 1800, async () => {
    const inputs = await loadRiskInputs(supabase, pid)
    if ('message' in inputs) return { message: inputs.message }
    const { common, aligned, benchmark, riskFreeRate } = inputs
    const symbols = common.symbols

    // The allocation: today's book, or one of the optimisation models' weights
    // computed on the same history with the engines the model comparison uses.
    let weights: number[] | null = common.currentWeights
    if (request.allocation === 'equalWeight') weights = symbols.map(() => 1 / symbols.length)
    if (request.allocation === 'riskParity') weights = riskParityWeights(calculateCovarianceMatrix(aligned.returnsMatrix))
    if (request.allocation === 'minCVaR') weights = minimiseCVaRWeights(aligned.returnsMatrix, 95)
    if (request.allocation === 'markowitz') {
      const expected = historicalExpectedReturns(aligned.returnsMatrix)
      const cov = calculateCovarianceMatrix(aligned.returnsMatrix).map((row) => row.map((v) => v * TRADING_DAYS_PER_YEAR))
      const frontier = expected ? efficientFrontier(symbols, cov, expected, { riskFreeRate }) : null
      weights = frontier ? symbols.map((s) => frontier.maxSharpe.weights.find((w) => w.symbol === s)?.weight ?? 0) : null
    }
    if (!weights) return { message: `No se pudieron calcular los pesos de ${PRESET_NAMES[request.allocation]} con este historial.` }

    const costsGiven = request.custodyAnnualPct > 0 || request.commissionPct > 0
    const useStored = !costsGiven && isCostModelConfigured(storedCosts)
    const spec = scenarioFromWeights({
      capital: request.capital ?? common.bookValue,
      symbols,
      weights,
      returnsMatrix: aligned.returnsMatrix,
      benchmarkReturns: aligned.benchmarkReturns ? { symbol: benchmark.symbol, returns: aligned.benchmarkReturns } : null,
      horizonMonths: request.horizonMonths,
      monthlyContribution: request.monthlyContribution,
      rebalance: request.rebalance,
      inflation: request.inflation,
      costs: costsGiven
        ? {
            ...DEFAULT_COST_MODEL,
            custodyAnnualPct: request.custodyAnnualPct,
            commissionPct: request.commissionPct,
            source: 'Costos indicados en el escenario',
          }
        : useStored
          ? storedCosts!
          : DEFAULT_COST_MODEL,
      shocks: request.shock ? [request.shock] : [],
      simulations: REQUEST_SIMULATIONS,
      expectedReturnOverride: request.expectedReturn,
    })

    const result = runScenario(spec)
    if ('errors' in result) return { message: result.errors.join(' ') }

    return {
      request,
      allocation: { preset: request.allocation, name: PRESET_NAMES[request.allocation], weights: spec.holdings },
      capital: spec.capital,
      /** The currency the capital, the contributions and every band are in: the portfolio's. */
      currency: inputs.currency,
      benchmark: spec.benchmark ? { symbol: benchmark.symbol, name: benchmark.name } : null,
      result,
      // How far the historical mean can be trusted, for the allocation simulated.
      estimates: estimateReliability(
        aligned.returnsMatrix[0].map((_, t) => spec.holdings.reduce((sum, h, i) => sum + h.weight * aligned.returnsMatrix[i][t], 0)),
        inputs.cadence.periodsPerYear,
      ),
      window: { from: common.commonDates[0], to: common.lastDate },
      _meta: riskInputsMetadata(inputs, 'scenarioEngine', {
        usesRiskFree: request.allocation === 'markowitz',
        assumptions: [
          { name: 'Proceso', value: 'Movimiento browniano geométrico correlacionado, pasos mensuales', source: 'docs/FINANCIAL_ASSUMPTIONS.md (Scenario engine)' },
          { name: 'Rendimiento esperado', value: result.model.riskSource, source: 'scenario-engine.ts' },
          { name: 'Trayectorias', value: String(result.model.simulations), source: 'scenario-engine.ts' },
          { name: 'Reproducibilidad', value: `Escenario ${result.model.key}, semilla ${result.model.seed}`, source: 'scenario-engine.ts' },
          result.model.gross
            ? COMMON_ASSUMPTIONS.gross
            : useStored
              ? { name: 'Costos', value: describeCostModel(storedCosts!), source: 'Costos del portafolio' }
              : { name: 'Costos', value: `Custodia ${request.custodyAnnualPct}% anual, comisión ${request.commissionPct}%`, source: 'Indicados en el escenario' },
        ],
      }),
    }
  })

  return success(data)
}

export const GET = apiHandler(getHandler)
