import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { apiHandler } from '@/lib/api/handler'
import { getHistory } from '@/lib/services/market'
import { getRiskFreeRate } from '@/lib/services/risk-free-rate'
import { compareStrategies } from '@/lib/services/strategy-engine'
import {
  validateStrategy,
  EXAMPLE_STRATEGIES,
  type Strategy,
} from '@/lib/services/strategy-rule'
import type { Bar } from '@/lib/services/backtest'

/**
 * Backtest a strategy the user built by clicking.
 *
 * POST because the strategy is the body: rules do not belong in a query string,
 * and nothing here is cached — the whole point is that the user is iterating on
 * the rules and wants to see each change.
 *
 * Six months of DAILY bars. Not five years: the provider only returns daily data
 * up to six months, and backtesting a "50-day average" on weekly bars silently
 * tests a 50-WEEK average instead. The window is short and the response says so
 * rather than letting a two-month sample read as evidence.
 */

/** Daily is the only cadence a bar-counting strategy can be honestly tested on. */
const HISTORY_RANGE = '6mo'

/** Round-trip cost per side. Zero would flatter every strategy that trades often. */
const DEFAULT_COST_PCT = 0.1

type Body = {
  strategy?: Strategy
  /** Compare against the built-in examples as well. */
  includeExamples?: boolean
  costPct?: number
  initialCapital?: number
}

async function postHandler(req: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return error('El cuerpo de la peticion no es JSON valido.', 400)
  }

  const upper = symbol.toUpperCase()

  // Validate before spending a provider call on a strategy that cannot run.
  if (body.strategy) {
    const validation = validateStrategy(body.strategy)
    if (!validation.valid) {
      return success({
        symbol: upper,
        valid: false,
        errors: validation.errors,
        warnings: validation.warnings,
      })
    }
  }

  const history = await getHistory(upper, HISTORY_RANGE).catch(() => [])
  const bars: Bar[] = []
  for (const point of history as Array<{ date: string; close: number | null; adjClose?: number | null }>) {
    // Adjusted close: a raw split is a -75% day and every rule would read it
    // as a crash worth selling into.
    const close = point.adjClose ?? point.close
    if (close == null || !Number.isFinite(close)) continue
    bars.push({ date: new Date(point.date).toISOString().slice(0, 10), close })
  }

  if (bars.length < 30) {
    return success({
      symbol: upper,
      message: 'No hay suficiente historial diario para probar una estrategia sobre este simbolo.',
    })
  }

  const riskFree = await getRiskFreeRate('USD')
  const options = {
    costPct: body.costPct ?? DEFAULT_COST_PCT,
    initialCapital: body.initialCapital,
    riskFreeRate: riskFree.rate,
  }

  // The user's strategy plus, optionally, the examples — all through
  // compareStrategies so every row shares one warmup and one benchmark.
  const toRun: Strategy[] = []
  if (body.strategy) toRun.push(body.strategy)
  if (body.includeExamples || !body.strategy) {
    toRun.push(...EXAMPLE_STRATEGIES.map((e) => e.strategy))
  }

  const comparison = compareStrategies(toRun, bars, options)
  if (!comparison) {
    return success({
      symbol: upper,
      message:
        'Ninguna de las estrategias pudo ejecutarse: el historial no alcanza para el calentamiento que necesitan.',
    })
  }

  // The user's own run, pulled out so the interface does not have to guess
  // which row is theirs.
  const own = body.strategy
    ? (comparison.results.find((r) => r.name === body.strategy!.name) ?? null)
    : null

  return success({
    symbol: upper,
    valid: true,
    bars: bars.length,
    from_date: bars[0].date,
    to_date: bars[bars.length - 1].date,
    cost_pct: options.costPct,
    risk_free_rate: {
      annual_pct: Math.round(riskFree.rate * 10000) / 100,
      source: riskFree.source,
    },
    own,
    comparison,
    // Said once, here, rather than left for the reader to work out from a
    // green equity curve.
    caveat:
      'Un backtest mide lo que habria pasado con ESTAS reglas sobre ESTE periodo, que ya ocurrio. No mide lo que va a pasar. Cuantas mas variantes pruebes, mas facil es encontrar una que gano por casualidad: eso se llama sobreajuste y es la forma mas comun de enganarse con una herramienta como esta.',
  })
}

export const POST = apiHandler(postHandler)
