import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { withCache } from '@/lib/cache/with-cache'
import { apiHandler } from '@/lib/api/handler'
import { loadRiskInputs } from '@/lib/jobs/kinds/risk-inputs'
import { calculateCovarianceMatrix } from '@/lib/services/covariance'
import { historicalExpectedReturns, efficientFrontier } from '@/lib/services/optimizer'
import { minimiseCVaRWeights, riskParityWeights } from '@/lib/services/allocation-strategies'
import { DEFAULT_COST_MODEL } from '@/lib/services/costs'
import {
  estimateReliability,
  parsePortfolioScenarioRequest,
  REQUEST_SIMULATIONS,
  runScenario,
  scenarioFromWeights,
  type AllocationPreset,
} from '@/lib/services/scenario-engine'

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
  const cacheKey = `analytics:scenario-engine:${user.id}:${pid}:${JSON.stringify(request)}`

  const data = await withCache(cacheKey, 1800, async () => {
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
      const cov = calculateCovarianceMatrix(aligned.returnsMatrix).map((row) => row.map((v) => v * 252))
      const frontier = expected ? efficientFrontier(symbols, cov, expected, { riskFreeRate }) : null
      weights = frontier ? symbols.map((s) => frontier.maxSharpe.weights.find((w) => w.symbol === s)?.weight ?? 0) : null
    }
    if (!weights) return { message: `No se pudieron calcular los pesos de ${PRESET_NAMES[request.allocation]} con este historial.` }

    const costsGiven = request.custodyAnnualPct > 0 || request.commissionPct > 0
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
      benchmark: spec.benchmark ? { symbol: benchmark.symbol, name: benchmark.name } : null,
      result,
      // How far the historical mean can be trusted, for the allocation simulated.
      estimates: estimateReliability(
        aligned.returnsMatrix[0].map((_, t) => spec.holdings.reduce((sum, h, i) => sum + h.weight * aligned.returnsMatrix[i][t], 0)),
        inputs.cadence.periodsPerYear,
      ),
      window: { from: common.commonDates[0], to: common.lastDate },
    }
  })

  return success(data)
}

export const GET = apiHandler(getHandler)
