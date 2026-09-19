import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { withAuditedCache } from '@/lib/cache/with-cache'
import { apiHandler } from '@/lib/api/handler'
import { loadRiskInputs, riskInputsMetadata } from '@/lib/jobs/kinds/risk-inputs'
import { calculateCovarianceMatrix } from '@/lib/services/covariance'
import { calculateBetaAlpha } from '@/lib/services/analytics'
import { riskParityWeights } from '@/lib/services/allocation-strategies'
import { driftTargets } from '@/lib/services/rebalance'

// The rebalance panel (P0-12, P1-10).
//
// rebalance.ts held a complete planner — deviation, bands, calendar, risk drift
// and a before/after simulator — and nothing imported it. This route does not
// re-run any of that: it serves the INPUTS, and the panel runs the pure planner
// in the browser as the reader changes the mode, the thresholds or the targets.
// A rebalance is something you try several ways before trusting, and a round
// trip per slider movement would make that miserable.
//
// Nothing here or in the panel executes a trade.

async function getHandler(_req: Request, { params }: { params: Promise<{ pid: string }> }) {
  const { pid } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const data = await withAuditedCache(`analytics:rebalance:${user.id}:${pid}`, 900, async () => {
    const inputs = await loadRiskInputs(supabase, pid)
    if ('message' in inputs) return { message: inputs.message }

    const { common, aligned, cadence, sectors, benchmark, riskFreeRate } = inputs
    const symbols = common.symbols
    const periods = cadence.periodsPerYear

    // The risk inputs are already in the book's currency (todaysSymbolFactors),
    // so their book value and weights are one unit. This route used to convert
    // them here, the one engine that did.
    const base = inputs.currency
    const bookValue = common.bookValue
    if (!(bookValue > 0)) return { message: 'El portafolio no tiene valor que rebalancear.' }
    const weights = common.currentWeights
    const values = weights.map((w) => w * bookValue)

    const cov = calculateCovarianceMatrix(aligned.returnsMatrix).map((row) => row.map((v) => v * periods))
    const expectedReturns = aligned.returnsMatrix.map((series) => (series.reduce((a, b) => a + b, 0) / series.length) * periods)

    // A book's beta is linear in its weights, so each holding's own beta is all
    // the simulator needs to report beta before and after.
    const assetBetas = aligned.benchmarkReturns
      ? aligned.returnsMatrix.map((series) => calculateBetaAlpha(series, aligned.benchmarkReturns!, riskFreeRate)?.beta ?? null)
      : null
    const betas = assetBetas && assetBetas.every((b): b is number => b !== null && Number.isFinite(b)) ? assetBetas : null

    const growth = common.returnsMatrix.map((series) => series.reduce((g, r) => g * (1 + r), 1))
    const toMap = (w: number[] | null) => (w ? Object.fromEntries(symbols.map((s, i) => [s, w[i]])) : null)

    return {
      currency: base,
      book_value: bookValue,
      holdings: symbols.map((symbol, i) => ({ symbol, value: values[i], weight: weights[i], sector: sectors[symbol] ?? null })),
      cov,
      expected_returns: expectedReturns,
      risk_free_rate: riskFreeRate,
      asset_betas: betas,
      benchmark,
      window: { from: common.commonDates[0], to: common.lastDate },
      // Ready-made targets. None of them is a recommendation; each answers a
      // different question, which is why the panel lets the reader pick.
      targets: {
        equal: toMap(symbols.map(() => 1 / symbols.length)),
        drift: toMap(driftTargets(weights, growth)),
        riskParity: toMap(riskParityWeights(cov)),
      },
      unconverted: inputs.unconverted,
      _meta: riskInputsMetadata(inputs, 'rebalance', {
        usesRiskFree: true,
        usesBenchmark: betas !== null,
        assumptions: [
          { name: 'Rendimiento esperado', value: 'Media histórica anualizada del periodo', source: 'Estimación (rebalance route)' },
          { name: 'Costos', value: 'No incluidos: la simulación no descuenta comisiones ni impuestos', source: 'Convención (rebalance.ts)' },
        ],
      }),
    }
  })

  return success(data)
}

export const GET = apiHandler(getHandler)
