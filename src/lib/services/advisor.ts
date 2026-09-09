// Advisor projection engine — pure functions, no I/O.
//
// The engine this replaces had three problems that fed each other.
//
// It drew fresh Math.random() shocks on every call, so asking the same question
// twice gave different answers and comparing two contribution levels compared
// two different universes. Raising a contribution could lower the reported
// probability, purely from luck.
//
// It answered "how much should I contribute" with the deterministic annuity
// solution — the amount that lands exactly on the mean — and then scored that
// amount with a stochastic simulation, where landing on the mean is roughly a
// coin flip. So the advisor recommended an amount, the user entered it, and the
// advisor reported the goal was still unlikely. That is the circular
// recommendation in the roadmap, and no amount of tuning fixes it while the two
// halves answer different questions.
//
// And it converted an annual return to a monthly one with pow(1 + r, 1/12),
// which is NaN whenever r is below -100%: not reachable at the old fixed 10%
// volatility, but one configuration change away.
//
// The fix is a scenario set. Shocks are drawn once from a seeded generator and
// every question is answered against that same set — common random numbers — so
// differences between two plans are differences between the plans. The
// contribution search then runs on the same scenarios as the probability it is
// solving for, which makes the loop close by construction.
//
// See docs/ADVISOR_MODEL_VERSIONING.md and docs/FINANCIAL_ASSUMPTIONS.md.

import { allocateMoney, roundMoney, toCents } from '@/lib/utils/money'
import { validateWeights } from './validation'

/** Bump on any change that moves a saved projection's numbers. */
export const ADVISOR_MODEL_VERSION = '2.0.0'

const MONTHS_PER_YEAR = 12

/**
 * Floor on a simulated annual return. A holding cannot lose more than
 * everything, and pow(1 + r, 1/12) below -100% is NaN rather than a loss.
 */
const MIN_ANNUAL_RETURN = -0.99

export type ScenarioRequest = { months: number; simulations: number; seed: number }

export type ScenarioSet = {
  seed: number
  simulations: number
  months: number
  /** shocks[simulation][month], standard normal. */
  shocks: number[][]
}

export type PlanParams = {
  capitalInicial: number
  aportacionMensual: number
  años: number
  /** Expected annual return as a fraction. */
  rendimientoAnual: number
  /** Annual standard deviation of that return, as a fraction. */
  volatilidadAnual: number
}

export type Distribucion = {
  p10: number
  p25: number
  p50: number
  p75: number
  p90: number
  media: number
  min: number
  max: number
}

export type PlanOutcome = {
  /** What the plan grows to with no randomness at all — the textbook annuity. */
  proyeccionDeterminista: {
    historial: number[]
    capitalAportado: number
    valorFinal: number
    ganancia: number
    rentabilidadTotalPct: number
  }
  distribucion: Distribucion
  probabilidadMetaPct: number | null
  perdidaPotencial: {
    escenarioP10: number
    /** P10 outcome minus what was actually paid in. Negative means a real loss. */
    vsAportado: number
  }
  modelo: {
    version: string
    seed: number
    simulaciones: number
    meses: number
    rendimientoAnual: number
    volatilidadAnual: number
  }
}

// ─── Seeded randomness ──────────────────────────────────────────────────────

/** mulberry32 — small, fast, and good enough for a teaching projection. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Draw the shocks once, up front.
 *
 * Every question asked of a plan is answered against this one set, so raising a
 * contribution or lengthening a horizon changes the answer for the reason the
 * user changed, not because a different set of coin flips came up.
 */
export function buildScenarios(request: ScenarioRequest): ScenarioSet {
  const months = Math.max(0, Math.floor(request.months))
  const simulations = Math.max(1, Math.floor(request.simulations))
  const random = mulberry32(request.seed)

  const shocks: number[][] = []
  for (let sim = 0; sim < simulations; sim++) {
    const path = new Array<number>(months)
    for (let month = 0; month < months; month++) {
      // Box-Muller. u1 is clamped off zero so log never sees it.
      const u1 = Math.max(random(), Number.MIN_VALUE)
      const u2 = random()
      path[month] = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
    }
    shocks.push(path)
  }

  return { seed: request.seed, simulations, months, shocks }
}

// ─── Projection ─────────────────────────────────────────────────────────────

function monthlyRate(annualReturn: number): number {
  return Math.pow(1 + Math.max(MIN_ANNUAL_RETURN, annualReturn), 1 / MONTHS_PER_YEAR) - 1
}

/** The plan with no randomness: the number a compound-interest table would give. */
function deterministicProjection(params: PlanParams) {
  const months = Math.max(0, Math.round(params.años * MONTHS_PER_YEAR))
  const rate = monthlyRate(params.rendimientoAnual)

  const historial: number[] = []
  let value = params.capitalInicial
  for (let month = 1; month <= months; month++) {
    value = value * (1 + rate) + params.aportacionMensual
    if (month % MONTHS_PER_YEAR === 0) historial.push(roundMoney(value))
  }

  const capitalAportado = roundMoney(params.capitalInicial + params.aportacionMensual * months)
  const valorFinal = roundMoney(value)
  const ganancia = roundMoney(valorFinal - capitalAportado)

  return {
    historial,
    capitalAportado,
    valorFinal,
    ganancia,
    rentabilidadTotalPct:
      capitalAportado > 0 ? (ganancia / capitalAportado) * 100 : ganancia > 0 ? 100 : 0,
  }
}

/**
 * Final value of one simulated path.
 *
 * The shock perturbs the annual return, which is then floored before being
 * converted to a monthly rate — the floor is what keeps pow() away from a
 * negative base.
 */
function simulatePath(params: PlanParams, shocks: number[], months: number): number {
  let value = params.capitalInicial
  for (let month = 0; month < months; month++) {
    const annual = params.rendimientoAnual + shocks[month] * params.volatilidadAnual
    value = value * (1 + monthlyRate(annual)) + params.aportacionMensual
    if (!Number.isFinite(value)) return 0
  }
  return Math.max(0, value)
}

/** Every simulated final value, ascending. */
function simulateAll(params: PlanParams, scenarios: ScenarioSet): number[] {
  const months = Math.min(
    scenarios.months,
    Math.max(0, Math.round(params.años * MONTHS_PER_YEAR)),
  )
  const outcomes = scenarios.shocks.map((path) => simulatePath(params, path, months))
  return outcomes.sort((a, b) => a - b)
}

/** Percentile of an already-sorted series, by nearest rank. */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[index]
}

function distributionOf(sorted: number[]): Distribucion {
  const mean = sorted.length === 0 ? 0 : sorted.reduce((a, b) => a + b, 0) / sorted.length
  return {
    p10: roundMoney(percentile(sorted, 10)),
    p25: roundMoney(percentile(sorted, 25)),
    p50: roundMoney(percentile(sorted, 50)),
    p75: roundMoney(percentile(sorted, 75)),
    p90: roundMoney(percentile(sorted, 90)),
    media: roundMoney(mean),
    min: roundMoney(sorted[0] ?? 0),
    max: roundMoney(sorted[sorted.length - 1] ?? 0),
  }
}

/**
 * Evaluate a plan against one scenario set.
 *
 * The deterministic projection and the simulated distribution are reported side
 * by side and never conflated: the first is what the plan does at the expected
 * return, the second is the range of things it might do. Presenting either as
 * the other is how a projection turns into a promise.
 */
export function evaluarPlan(
  params: PlanParams,
  meta: number | null,
  scenarios: ScenarioSet,
): PlanOutcome {
  const sorted = simulateAll(params, scenarios)
  const distribucion = distributionOf(sorted)
  const deterministic = deterministicProjection(params)

  return {
    proyeccionDeterminista: deterministic,
    distribucion,
    probabilidadMetaPct:
      meta === null || !Number.isFinite(meta) ? null : probabilityFromSorted(sorted, meta),
    perdidaPotencial: {
      escenarioP10: distribucion.p10,
      vsAportado: roundMoney(distribucion.p10 - deterministic.capitalAportado),
    },
    modelo: {
      version: ADVISOR_MODEL_VERSION,
      seed: scenarios.seed,
      simulaciones: scenarios.simulations,
      meses: scenarios.months,
      rendimientoAnual: params.rendimientoAnual,
      volatilidadAnual: params.volatilidadAnual,
    },
  }
}

function probabilityFromSorted(sorted: number[], meta: number): number {
  if (sorted.length === 0) return 0
  const successes = sorted.filter((value) => value >= meta).length
  return (successes / sorted.length) * 100
}

/** Share of simulated paths that reach the goal, as a percentage. */
export function probabilidadDeMeta(
  params: PlanParams,
  meta: number,
  scenarios: ScenarioSet,
): number {
  return probabilityFromSorted(simulateAll(params, scenarios), meta)
}

// ─── Solving for the contribution ───────────────────────────────────────────

/** Beyond this the answer is not a plan, it is a rejection. */
const MAX_SEARCH_CONTRIBUTION = 1e9
const SEARCH_ITERATIONS = 60

/**
 * The smallest monthly contribution that reaches `probabilidadObjetivo` on THIS
 * scenario set.
 *
 * Solved by bisection against the same simulated paths the probability is
 * measured on, which is what makes the recommendation stick: feed the answer
 * back in and the model agrees the goal is now likely, because it is answering
 * with the same universe it used to pick the number. The old deterministic
 * annuity solution could not do that — it targeted the mean, and the mean is
 * roughly a coin flip.
 *
 * Returns 0 when the goal is already reached with no contributions at all, and
 * null when no contribution within reach gets there.
 */
export function aporteParaProbabilidadMeta(
  params: PlanParams,
  meta: number,
  probabilidadObjetivo: number,
  scenarios: ScenarioSet,
): number | null {
  if (!Number.isFinite(probabilidadObjetivo) || probabilidadObjetivo < 0 || probabilidadObjetivo > 100) {
    return null
  }
  if (!Number.isFinite(meta)) return null

  const probabilityAt = (aportacionMensual: number) =>
    probabilidadDeMeta({ ...params, aportacionMensual }, meta, scenarios)

  if (probabilityAt(0) >= probabilidadObjetivo) return 0

  // Expand until the goal is reachable, so bisection has a bracket.
  let high = Math.max(100, Math.abs(params.aportacionMensual) || 100)
  while (probabilityAt(high) < probabilidadObjetivo) {
    high *= 2
    if (high > MAX_SEARCH_CONTRIBUTION) return null
  }

  let low = 0
  for (let i = 0; i < SEARCH_ITERATIONS && high - low > 0.01; i++) {
    const mid = (low + high) / 2
    if (probabilityAt(mid) >= probabilidadObjetivo) high = mid
    else low = mid
  }

  const answer = roundMoney(high)
  // Rounding down to the cent could drop the answer just under the target.
  return probabilityAt(answer) >= probabilidadObjetivo ? answer : roundMoney(answer + 0.01)
}

// ─── Auditing a suggested portfolio ─────────────────────────────────────────

export type CarteraAudit = {
  valid: boolean
  problems: string[]
  asignaciones: Array<{
    activo: string
    peso: number
    capital: number
    aportacionMensual: number
  }>
}

/**
 * Check a suggested allocation before anyone acts on it, and work out what each
 * sleeve actually receives.
 *
 * The money is split with allocateMoney rather than multiplied weight by weight,
 * so the rows add back up to the capital and to the monthly contribution
 * exactly — the number in the table footer and the sum of the table are the
 * same number.
 */
export function auditarCartera(
  cartera: Record<string, number>,
  capital: number,
  aportacionMensual: number,
): CarteraAudit {
  const problems: string[] = []
  const activos = Object.keys(cartera)
  const pesos = Object.values(cartera)

  if (activos.length === 0) problems.push('The suggested portfolio has no assets in it.')

  const weightCheck = validateWeights(pesos)
  if (activos.length > 0 && !weightCheck.valid) problems.push(weightCheck.reason!)

  if (!Number.isFinite(capital) || capital < 0) {
    problems.push('Starting capital must be zero or more.')
  }
  if (!Number.isFinite(aportacionMensual) || aportacionMensual < 0) {
    problems.push('The monthly contribution must be zero or more.')
  }

  if (problems.length > 0) return { valid: false, problems, asignaciones: [] }

  const capitalParts = allocateMoney(capital, pesos)
  const monthlyParts = allocateMoney(aportacionMensual, pesos)

  return {
    valid: true,
    problems: [],
    asignaciones: activos.map((activo, i) => ({
      activo,
      peso: pesos[i],
      capital: capitalParts[i],
      aportacionMensual: monthlyParts[i],
    })),
  }
}

// ─── Input validation (P0-24) ───────────────────────────────────────────────

export type EntradasAdvisor = {
  edad: number
  ingresos: number
  horizonte: number
  capitalInicial: number
  aportacionMensual: number
  meta: number
  porcentajeInversion: number
  riesgo: number
  experiencia: number
  estabilidad: number
  reaccion: number
}

export type CampoProblema = { field: keyof EntradasAdvisor; message: string }

export type ValidacionEntradas = {
  valid: boolean
  /** Answers the model cannot work with at all. */
  errors: CampoProblema[]
  /** Answers that are valid but worth questioning before acting on them. */
  warnings: CampoProblema[]
}

/** A contribution past this share of income is worth flagging, not blocking. */
const ALARMING_SAVINGS_RATE = 0.5

type Rule = {
  field: keyof EntradasAdvisor
  min: number
  max: number
  message: string
}

const RULES: Rule[] = [
  { field: 'edad', min: 18, max: 100, message: 'La edad debe estar entre 18 y 100 anios.' },
  { field: 'ingresos', min: 0, max: 1e12, message: 'El ingreso mensual no puede ser negativo.' },
  { field: 'horizonte', min: 1, max: 100, message: 'El horizonte debe ser de al menos 1 anio y como maximo 100.' },
  { field: 'capitalInicial', min: 0, max: 1e15, message: 'El capital inicial no puede ser negativo.' },
  { field: 'aportacionMensual', min: 0, max: 1e15, message: 'La aportacion mensual no puede ser negativa.' },
  { field: 'meta', min: 0.01, max: 1e15, message: 'La meta debe ser mayor que cero.' },
  { field: 'porcentajeInversion', min: 0, max: 100, message: 'El porcentaje a invertir debe estar entre 0% y 100%.' },
  { field: 'riesgo', min: 1, max: 10, message: 'La tolerancia al riesgo se mide del 1 al 10.' },
  { field: 'experiencia', min: 1, max: 4, message: 'Selecciona tu nivel de experiencia.' },
  { field: 'estabilidad', min: 1, max: 4, message: 'Selecciona tu estabilidad de ingresos.' },
  { field: 'reaccion', min: 1, max: 4, message: 'Selecciona como reaccionarias ante una caida.' },
]

/**
 * Check the questionnaire before anything is simulated.
 *
 * Every problem is reported at once rather than one per attempt, because a form
 * that reveals its objections one at a time is a form people abandon.
 *
 * Errors and warnings are kept apart deliberately. An age of -5 is not a plan,
 * it is a typo. A contribution of 90% of income IS a plan — an alarming one —
 * and the model should say so while still running it: deciding it is impossible
 * on the user's behalf is not this tool's job.
 *
 * The advisor runs entirely in the browser today, so this is the only place the
 * check can live. If a projection endpoint is ever added it must call this same
 * function server-side; validation that exists only in the client is decoration.
 */
export function validarEntradasAdvisor(entradas: EntradasAdvisor): ValidacionEntradas {
  const errors: CampoProblema[] = []

  for (const rule of RULES) {
    const value = entradas[rule.field]
    if (!Number.isFinite(value)) {
      errors.push({ field: rule.field, message: rule.message })
      continue
    }
    if (value < rule.min || value > rule.max) {
      errors.push({ field: rule.field, message: rule.message })
    }
  }

  const warnings: CampoProblema[] = []
  if (
    errors.length === 0 &&
    entradas.ingresos > 0 &&
    entradas.aportacionMensual / entradas.ingresos > ALARMING_SAVINGS_RATE
  ) {
    const pct = ((entradas.aportacionMensual / entradas.ingresos) * 100).toFixed(0)
    warnings.push({
      field: 'aportacionMensual',
      message:
        'Esa aportacion equivale al ' +
        pct +
        '% de tu ingreso mensual. El calculo es valido, pero conviene revisar si es sostenible.',
    })
  }

  return { valid: errors.length === 0, errors, warnings }
}

/** Exposed for callers that need to compare money exactly. */
export const advisorInternals = { toCents }
