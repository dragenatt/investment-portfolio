import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { withCacheInfo } from '@/lib/cache/with-cache'
import { buildResultMetadata, COMMON_ASSUMPTIONS, type PriceSource } from '@/lib/services/result-metadata'
import { apiHandler } from '@/lib/api/handler'
import { fetchAdjustedPriceHistory } from '@/lib/services/price-history'
import { alignCommonHistory } from '@/lib/services/common-history'
import { calculateCovarianceMatrix } from '@/lib/services/covariance'
import { getRiskFreeRate } from '@/lib/services/risk-free-rate'
import { efficientFrontier, historicalExpectedReturns } from '@/lib/services/optimizer'
import { compareAllocationStrategies } from '@/lib/services/allocation-strategies'
import {
  compareScenarios,
  parseScenarioRequest,
  type Scenario,
  type ScenarioId,
} from '@/lib/services/scenario-comparison'

const TRADING_DAYS = 252
/** Same floor as the optimization route: below it a covariance is not worth simulating on. */
const MIN_OBSERVATIONS = 60

type Candidate = { id: ScenarioId; name: string; rationale: string; weights: number[] }

type Inputs =
  | { message: string }
  | {
      symbols: string[]
      returnsMatrix: number[][]
      observations: number
      fromDate: string
      toDate: string
      riskFree: Awaited<ReturnType<typeof getRiskFreeRate>>
      candidates: Candidate[]
      priceSource: PriceSource
      excluded: string[]
      computedAt: string
    }

/**
 * Two or more allocations of the same holdings on the same simulated futures (E2).
 *
 * `GET ?horizon=1|3|5|10&include=current,equalWeight,...&custom=VOO:70,AAPL:30`
 *
 * The expensive part — price history, the optimisers that produce the candidate
 * allocations, the risk-free rate — is cached per portfolio. The simulation
 * itself runs per request, because it depends on the horizon and the scenarios
 * chosen, and takes milliseconds.
 */
async function getHandler(req: Request, { params }: { params: Promise<{ pid: string }> }) {
  const { pid } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  // Scoped to the caller: RLS decided what went into these inputs.
  const INPUTS_TTL = 900
  const { data: inputs, cached: inputsCached } = await withCacheInfo<Inputs>(`analytics:scenario-inputs:${user.id}:${pid}`, INPUTS_TTL, async () => {
    const { data: portfolio } = await supabase
      .from('portfolios')
      .select('currency:base_currency')
      .eq('id', pid)
      .single()

    const { data: positions } = await supabase
      .from('positions')
      .select('symbol, quantity')
      .eq('portfolio_id', pid)
      .gt('quantity', 0)

    const symbols = (positions ?? []).map((p) => p.symbol)
    const { rows: history, source: priceSource } =
      symbols.length >= 2
        ? await fetchAdjustedPriceHistory(supabase, symbols, { limit: undefined })
        : { rows: [], source: 'none' as const }

    const aligned = alignCommonHistory(positions ?? [], history, { minObservations: MIN_OBSERVATIONS })
    if ('message' in aligned) return { message: aligned.message }

    const { symbols: active, returnsMatrix, currentWeights, commonDates, lastDate } = aligned
    const riskFree = await getRiskFreeRate(portfolio?.currency ?? 'USD')

    const byWeights = (weights: Array<{ symbol: string; weight: number }>) =>
      active.map((symbol) => weights.find((w) => w.symbol === symbol)?.weight ?? 0)

    const candidates: Candidate[] = []

    if (currentWeights) {
      candidates.push({
        id: 'current',
        name: 'Tu cartera actual',
        rationale: 'Tus posiciones valuadas al ultimo precio comun. Es la referencia contra la que se explica todo lo demas.',
        weights: currentWeights,
      })
    }

    // The same four strategies the optimization tab shows, so a name here means
    // exactly what it means there.
    const strategies = compareAllocationStrategies(active, returnsMatrix, 95)
    for (const strategy of strategies?.strategies ?? []) {
      candidates.push({
        id: strategy.id,
        name: strategy.name,
        rationale: strategy.rationale,
        weights: byWeights(strategy.weights),
      })
    }

    const expected = historicalExpectedReturns(returnsMatrix)
    const cov = calculateCovarianceMatrix(returnsMatrix).map((row) => row.map((v) => v * TRADING_DAYS))
    const frontier = expected
      ? efficientFrontier(active, cov, expected, { riskFreeRate: riskFree.rate, currentWeights })
      : null
    if (frontier) {
      candidates.push({
        id: 'minVariance',
        name: 'Minima varianza',
        rationale:
          'El punto de menor volatilidad de la frontera eficiente. No usa ninguna estimacion de rendimiento, solo la covarianza.',
        weights: byWeights(frontier.minimumVariance.weights),
      })
      candidates.push({
        id: 'maxSharpe',
        name: 'Maximo Sharpe estimado',
        rationale:
          'El punto de la frontera con mejor rendimiento estimado por unidad de riesgo. Es el mas sensible a que las estimaciones de rendimiento esten mal, y suelen estarlo.',
        weights: byWeights(frontier.maxSharpe.weights),
      })
    }

    return {
      symbols: active,
      returnsMatrix,
      observations: commonDates.length - 1,
      fromDate: commonDates[0],
      toDate: lastDate,
      riskFree,
      candidates,
      priceSource,
      excluded: symbols.filter((s) => !active.includes(s)),
      computedAt: new Date().toISOString(),
    }
  })

  if ('message' in inputs) return success({ message: inputs.message })

  const request = parseScenarioRequest(new URL(req.url).searchParams, inputs.symbols)

  const scenarios: Scenario[] = []
  for (const id of request.include) {
    if (id === 'custom' && request.custom) {
      scenarios.push({
        id: 'custom',
        name: 'Personalizado',
        rationale: 'La asignacion que elegiste.',
        weights: request.custom,
      })
      continue
    }
    const candidate = inputs.candidates.find((c) => c.id === id)
    if (candidate) scenarios.push(candidate)
  }

  const comparison =
    scenarios.length >= 2
      ? compareScenarios({
          symbols: inputs.symbols,
          returnsMatrix: inputs.returnsMatrix,
          scenarios,
          riskFreeRate: inputs.riskFree.rate,
          horizonYears: request.horizonYears,
        })
      : null

  return success({
    symbols: inputs.symbols,
    observations: inputs.observations,
    from_date: inputs.fromDate,
    to_date: inputs.toDate,
    risk_free_rate: {
      currency: inputs.riskFree.currency,
      annual_pct: Math.round(inputs.riskFree.rate * 10000) / 100,
      source: inputs.riskFree.source,
      as_of: inputs.riskFree.asOf,
      is_fallback: inputs.riskFree.isFallback,
    },
    // Everything the page can offer, so it can render the chooser.
    available: inputs.candidates.map((c) => ({ id: c.id, name: c.name, rationale: c.rationale })),
    request: { horizon_years: request.horizonYears, include: request.include, errors: request.errors },
    comparison,
    message: comparison ? null : 'Elige al menos dos escenarios para compararlos.',
    _meta: {
      ...buildResultMetadata({
        model: 'scenarioComparison',
        data: { description: 'Rendimientos diarios de las posiciones en sus fechas comunes', symbols: inputs.symbols, excluded: inputs.excluded, priceSource: inputs.priceSource },
        period: { from: inputs.fromDate, to: inputs.toDate, observations: inputs.observations, cadence: '1 dia' },
        assumptions: [
          COMMON_ASSUMPTIONS.tradingDays,
          COMMON_ASSUMPTIONS.splitAdjusted,
          { name: 'Simulación', value: 'Movimiento browniano geométrico correlacionado, semanal, mismas trayectorias para todas las asignaciones', source: 'monte-carlo.ts (simulateWeightings)' },
          { name: 'Horizonte', value: `${request.horizonYears} años`, source: 'Elegido en la página' },
        ],
        riskFreeRate: inputs.riskFree,
      }),
      // The comparison runs on each request; its inputs may come from the
      // cache, and then they are as old as when they were stored.
      computedAt: inputs.computedAt,
      cache: { served: inputsCached ? 'cache' : 'computed', ttlSeconds: INPUTS_TTL },
    },
  })
}

export const GET = apiHandler(getHandler)
