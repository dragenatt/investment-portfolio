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
import { validateWeights, validateProbability } from './validation'

/** Bump on any change that moves a saved projection's numbers. */
export const ADVISOR_MODEL_VERSION = '2.1.0'

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

/** Box-Muller. u1 is clamped off zero so log never sees it. */
function standardNormal(random: () => number): number {
  const u1 = Math.max(random(), Number.MIN_VALUE)
  const u2 = random()
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
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
    for (let month = 0; month < months; month++) path[month] = standardNormal(random)
    shocks.push(path)
  }

  return { seed: request.seed, simulations, months, shocks }
}

/**
 * Lengthen a scenario set without disturbing the months it already holds.
 *
 * Rebuilding a longer set from scratch is not an option. buildScenarios consumes
 * draws path by path, so asking for more months shifts the stream for every
 * simulation after the first, and the sensitivity table's "current" row would
 * stop matching the projection printed above it.
 *
 * The extra months come from a second, independently seeded stream. The shocks
 * are iid standard normals, so which generator produced a given one is
 * immaterial; what matters is that the ones already drawn do not move.
 */
function extendScenarios(scenarios: ScenarioSet, months: number): ScenarioSet {
  if (months <= scenarios.months) return scenarios

  const extra = months - scenarios.months
  const random = mulberry32((scenarios.seed ^ 0x9e3779b9) >>> 0)
  const shocks = scenarios.shocks.map((path) => {
    const extended = path.slice()
    for (let i = 0; i < extra; i++) extended.push(standardNormal(random))
    return extended
  })

  return { ...scenarios, months, shocks }
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
/** Independent monthly shocks accumulate as sqrt(time), so scale by sqrt(12). */
const MONTHS_SQRT = Math.sqrt(MONTHS_PER_YEAR)

/**
 * One month of a simulated path.
 *
 * The shock is scaled to a MONTHLY standard deviation. The earlier version
 * drew a fresh annual-equivalent return every month and converted the whole
 * thing to a monthly rate:
 *
 *     monthlyRate(mu + shock * sigma)
 *
 * which averages twelve independent annual draws inside each year and so
 * divides the realised annual standard deviation by sqrt(12). A profile
 * documented at 10% volatility delivered 2.7%; the aggressive profile's 16%
 * delivered 4.4%. Measured, not inferred — see the tests.
 *
 * The consequence was not cosmetic. Every probability the advisor reported was
 * computed against a market three and a half times calmer than the one the
 * assumptions register describes, so every one of them was too confident, and
 * the uncertainty fan D7 exists to draw was that much too narrow.
 *
 * sqrt(time) scaling is the same convention used everywhere else in this
 * codebase for annualising, and it restores the documented figure to within
 * sampling error. It also brings back volatility drag: the median outcome now
 * falls as volatility rises at a fixed mean return, which is a real property of
 * compounding that the old form largely erased.
 */
function monthlyStep(params: PlanParams, shock: number): number {
  const drift = monthlyRate(params.rendimientoAnual)
  const monthly = drift + (shock * params.volatilidadAnual) / MONTHS_SQRT
  // Cannot lose more than everything in one month.
  return Math.max(-1, monthly)
}

function simulatePath(params: PlanParams, shocks: number[], months: number): number {
  let value = params.capitalInicial
  for (let month = 0; month < months; month++) {
    value = value * (1 + monthlyStep(params, shocks[month])) + params.aportacionMensual
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

export type BandaAnual = {
  /** 1-based year of the plan. */
  año: number
  p10: number
  p25: number
  p50: number
  p75: number
  p90: number
  /** What has actually been paid in by the end of that year. */
  aportado: number
}

/**
 * The fan, year by year, rather than only at the finish line.
 *
 * evaluarPlan reports where the simulations END. Drawing only that leaves the
 * chart showing one smooth deterministic curve, which is a picture of a plan
 * with no uncertainty in it at all — the exact impression D7 exists to correct.
 * These are cross-sectional percentiles: for each year, where the whole cloud
 * of simulations stands at that moment.
 *
 * A separate pass rather than something evaluarPlan returns. The sensitivity
 * sweep calls evaluarPlan eighteen times and needs none of this; making every
 * caller pay for it would be the wrong trade for the one caller that draws it.
 *
 * The last year's percentiles are identical to evaluarPlan's distribution, by
 * construction — same shocks, same paths, same nearest-rank percentile — so the
 * right edge of the chart cannot disagree with the summary above it.
 */
export function bandasDeIncertidumbre(
  params: PlanParams,
  scenarios: ScenarioSet,
): BandaAnual[] {
  const months = Math.min(
    scenarios.months,
    Math.max(0, Math.round(params.años * MONTHS_PER_YEAR)),
  )
  const years = Math.floor(months / MONTHS_PER_YEAR)
  if (years === 0) return []

  // porAño[year][simulation] — every simulation's value at each year boundary.
  const porAño: number[][] = Array.from({ length: years }, () => [])

  for (const shocks of scenarios.shocks) {
    let value = params.capitalInicial
    let roto = false
    for (let month = 0; month < years * MONTHS_PER_YEAR; month++) {
      if (!roto) {
        value = value * (1 + monthlyStep(params, shocks[month])) + params.aportacionMensual
        // Same guard as simulatePath: a path that leaves the reals is recorded
        // as zero rather than poisoning every percentile above it.
        if (!Number.isFinite(value)) {
          value = 0
          roto = true
        }
      }
      if ((month + 1) % MONTHS_PER_YEAR === 0) {
        porAño[(month + 1) / MONTHS_PER_YEAR - 1].push(Math.max(0, value))
      }
    }
  }

  return porAño.map((valores, index) => {
    const sorted = valores.sort((a, b) => a - b)
    const año = index + 1
    return {
      año,
      p10: roundMoney(percentile(sorted, 10)),
      p25: roundMoney(percentile(sorted, 25)),
      p50: roundMoney(percentile(sorted, 50)),
      p75: roundMoney(percentile(sorted, 75)),
      p90: roundMoney(percentile(sorted, 90)),
      aportado: roundMoney(
        params.capitalInicial + params.aportacionMensual * año * MONTHS_PER_YEAR,
      ),
    }
  })
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

// ─── Sensitivity (P1-4) ─────────────────────────────────────────────────────
//
// Every row below runs on the SAME scenario set as every other. That is what
// makes a sensitivity table meaningful: the difference between two rows is the
// input that changed, not a different draw of luck.

export type SensitivityRow = {
  /** The value of the varied input for this row. */
  valor: number
  esActual: boolean
  medianaFinal: number
  p10Final: number
  probabilidadPct: number
  /** Change in probability against the current plan, in percentage points. */
  deltaProbabilidadPp: number
}

export type SensitivityAnalysis = {
  aportacion: SensitivityRow[]
  horizonte: SensitivityRow[]
  capital: SensitivityRow[]
  meta: SensitivityRow[]
  rendimiento: SensitivityRow[]
  volatilidad: SensitivityRow[]
}

function sensitivityRow(
  params: PlanParams,
  meta: number,
  scenarios: ScenarioSet,
  valor: number,
  esActual: boolean,
  baselineProbability: number,
): SensitivityRow {
  const sorted = simulateAll(params, scenarios)
  const distribucion = distributionOf(sorted)
  const probabilidadPct = probabilityFromSorted(sorted, meta)
  return {
    valor,
    esActual,
    medianaFinal: distribucion.p50,
    p10Final: distribucion.p10,
    probabilidadPct,
    deltaProbabilidadPp: probabilidadPct - baselineProbability,
  }
}

function sweep(
  base: PlanParams,
  meta: number,
  scenarios: ScenarioSet,
  values: number[],
  currentValue: number,
  apply: (params: PlanParams, value: number) => { params: PlanParams; meta: number },
  baselineProbability: number,
): SensitivityRow[] {
  return values.map((value) => {
    const { params, meta: rowMeta } = apply(base, value)
    return sensitivityRow(
      params,
      rowMeta,
      scenarios,
      value,
      value === currentValue,
      baselineProbability,
    )
  })
}

/**
 * How much each assumption is actually worth.
 *
 * The most useful column is usually the expected return: a reader who sees that
 * two points of assumed return move the answer more than doubling their
 * contribution has learned something about how much of the projection rests on
 * a number nobody can know.
 */
export function analizarSensibilidad(
  base: PlanParams,
  meta: number,
  request: ScenarioSet,
): SensitivityAnalysis {
  const identity = (params: PlanParams) => ({ params, meta })

  const contributions = [
    roundMoney(base.aportacionMensual * 0.8),
    base.aportacionMensual,
    roundMoney(base.aportacionMensual * 1.2),
  ]
  // A horizon can be shortened but never below a single year.
  const horizons = [Math.max(1, base.años - 5), base.años, base.años + 5]

  // The longest row needs shocks to run on. Callers size their scenario set to
  // the plan's own horizon, so without this the "+5 years" row simulates only
  // the months available — simulateAll clamps to them — and reports the BASE
  // horizon's outcome as though it were the longer one. In the exported plan
  // that showed up as a 25-year median identical to the 20-year one, peso for
  // peso. Extending leaves every month already drawn exactly where it was.
  const scenarios = extendScenarios(request, Math.max(...horizons) * MONTHS_PER_YEAR)
  const baseline = probabilidadDeMeta(base, meta, scenarios)
  const capitals = [
    roundMoney(base.capitalInicial * 0.8),
    base.capitalInicial,
    roundMoney(base.capitalInicial * 1.2),
  ]
  const goals = [roundMoney(meta * 0.8), meta, roundMoney(meta * 1.2)]
  const returns = [
    base.rendimientoAnual - 0.02,
    base.rendimientoAnual,
    base.rendimientoAnual + 0.02,
  ]
  const volatilities = [
    Math.max(0, base.volatilidadAnual - 0.05),
    base.volatilidadAnual,
    base.volatilidadAnual + 0.05,
  ]

  return {
    aportacion: sweep(
      base, meta, scenarios, contributions, base.aportacionMensual,
      (p, v) => identity({ ...p, aportacionMensual: v }), baseline,
    ),
    horizonte: sweep(
      base, meta, scenarios, horizons, base.años,
      (p, v) => identity({ ...p, años: v }), baseline,
    ),
    capital: sweep(
      base, meta, scenarios, capitals, base.capitalInicial,
      (p, v) => identity({ ...p, capitalInicial: v }), baseline,
    ),
    meta: sweep(
      base, meta, scenarios, goals, meta,
      (p, v) => ({ params: p, meta: v }), baseline,
    ),
    rendimiento: sweep(
      base, meta, scenarios, returns, base.rendimientoAnual,
      (p, v) => identity({ ...p, rendimientoAnual: v }), baseline,
    ),
    volatilidad: sweep(
      base, meta, scenarios, volatilities, base.volatilidadAnual,
      (p, v) => identity({ ...p, volatilidadAnual: v }), baseline,
    ),
  }
}

// ─── Strategy comparison (P1-5) ─────────────────────────────────────────────

export type EstrategiaOpcion = {
  aportacionMensual: number
  años: number
  /** Optional per-option overrides; otherwise the base plan's are used. */
  capitalInicial?: number
  rendimientoAnual?: number
  volatilidadAnual?: number
}

export type EstrategiaResultado = {
  aportacionMensual: number
  años: number
  capitalInicial: number
  rendimientoAnual: number
  totalAportado: number
  probabilidadPct: number
  valorEsperado: number
  mediana: number
  downsideP10: number
  /** Contribution as a share of monthly income, when income is known. */
  esfuerzoAhorroPct: number | null
  resumen: string
}

export type ComparacionEstrategias = {
  meta: number
  opciones: EstrategiaResultado[]
  nota: string
}

/**
 * Score several ways of reaching the same goal.
 *
 * Deliberately returns no "best" option. Twenty years at $1,500 and ten years at
 * $4,000 are not two attempts at one answer, they are different lives — one
 * costs less per month and takes a decade longer, the other frees up the decade
 * and costs nearly triple. Picking for the user would be substituting a
 * preference they never expressed for a calculation.
 */
export function compararEstrategias(
  base: PlanParams,
  meta: number,
  opciones: EstrategiaOpcion[],
  scenarios: ScenarioSet,
  contexto: { ingresoMensual?: number } = {},
): ComparacionEstrategias {
  const resultados = opciones.map((opcion) => {
    const params: PlanParams = {
      capitalInicial: opcion.capitalInicial ?? base.capitalInicial,
      aportacionMensual: opcion.aportacionMensual,
      años: opcion.años,
      rendimientoAnual: opcion.rendimientoAnual ?? base.rendimientoAnual,
      volatilidadAnual: opcion.volatilidadAnual ?? base.volatilidadAnual,
    }

    const sorted = simulateAll(params, scenarios)
    const distribucion = distributionOf(sorted)
    const probabilidadPct = probabilityFromSorted(sorted, meta)
    const totalAportado = roundMoney(params.aportacionMensual * params.años * MONTHS_PER_YEAR)

    const esfuerzoAhorroPct =
      contexto.ingresoMensual && contexto.ingresoMensual > 0
        ? (params.aportacionMensual / contexto.ingresoMensual) * 100
        : null

    return {
      aportacionMensual: params.aportacionMensual,
      años: params.años,
      capitalInicial: params.capitalInicial,
      rendimientoAnual: params.rendimientoAnual,
      totalAportado,
      probabilidadPct,
      valorEsperado: distribucion.media,
      mediana: distribucion.p50,
      downsideP10: distribucion.p10,
      esfuerzoAhorroPct,
      resumen:
        'Aportar ' +
        params.aportacionMensual.toFixed(0) +
        ' al mes durante ' +
        params.años +
        ' anios suma ' +
        totalAportado.toFixed(0) +
        ' de tu bolsillo, con una probabilidad estimada de ' +
        probabilidadPct.toFixed(0) +
        '% bajo los supuestos actuales.',
    }
  })

  return {
    meta,
    opciones: resultados,
    nota:
      'Ninguna de estas opciones es la correcta por si sola: cambian cuanto cuesta cada mes, ' +
      'cuantos anios ocupa y cuanto riesgo corres de quedarte corto. La eleccion depende de que ' +
      'estas dispuesto a ceder, y eso no lo decide el modelo.',
  }
}

// ─── Projected goal date (P1-6) ─────────────────────────────────────────────

export type ProyeccionFechaMeta = {
  /** Month index at which the goal is first reached, by percentile of paths. */
  mesP25: number | null
  mesMediana: number | null
  mesP75: number | null
  fechaP25: string | null
  fechaMediana: string | null
  fechaP75: string | null
  simulacionesQueNoLlegan: number
  probabilidadPct: number
  advertencia: string
}

function addMonths(from: Date, months: number): string {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + months, 1))
  return d.toISOString().slice(0, 7)
}

/**
 * When each simulated path FIRST reaches the goal.
 *
 * "First" matters: a path that crosses the goal and later falls back still got
 * there, and a reader planning around a date cares about arrival, not about
 * whether it held. Paths that never arrive are counted rather than dropped —
 * excluding them would compute the median of the survivors and report it as the
 * median outcome, which is how a 40%-likely goal acquires a confident date.
 */
export function proyectarFechaMeta(
  params: PlanParams,
  meta: number,
  scenarios: ScenarioSet,
  options: { desde?: Date } = {},
): ProyeccionFechaMeta | null {
  if (!Number.isFinite(meta)) return null

  const months = Math.min(
    scenarios.months,
    Math.max(0, Math.round(params.años * MONTHS_PER_YEAR)),
  )
  if (months < 1) return null

  const arrivals: number[] = []
  let never = 0

  for (const path of scenarios.shocks) {
    let value = params.capitalInicial
    let arrivedAt: number | null = null

    if (value >= meta) arrivedAt = 0

    for (let month = 0; month < months && arrivedAt === null; month++) {
      value = value * (1 + monthlyStep(params, path[month])) + params.aportacionMensual
      if (!Number.isFinite(value)) break
      if (value >= meta) arrivedAt = month + 1
    }

    if (arrivedAt === null) never++
    else arrivals.push(arrivedAt)
  }

  arrivals.sort((a, b) => a - b)
  const total = scenarios.shocks.length
  const probabilidadPct = total > 0 ? ((total - never) / total) * 100 : 0

  const at = (p: number): number | null => {
    if (arrivals.length === 0) return null
    // The percentile is taken over ALL paths, so a goal most paths miss has no
    // median arrival at all rather than a flattering one.
    const rank = Math.ceil((p / 100) * total)
    if (rank > arrivals.length) return null
    return arrivals[Math.max(0, rank - 1)]
  }

  const desde = options.desde ?? new Date()
  const mesP25 = at(25)
  const mesMediana = at(50)
  const mesP75 = at(75)

  const advertencia =
    mesMediana === null
      ? 'Menos de la mitad de los escenarios simulados alcanza esta meta en el plazo, asi que no hay una fecha central que reportar. Amplia el horizonte, sube la aportacion o ajusta la meta.'
      : 'Estas fechas son percentiles de escenarios simulados, no una prediccion: en 1 de cada 4 casos la meta llega antes de ' +
        addMonths(desde, mesP25 ?? 0) +
        ' y en 1 de cada 4 mas tarde de ' +
        addMonths(desde, mesP75 ?? 0) +
        '. ' +
        never +
        ' de ' +
        total +
        ' escenarios no llegan dentro del plazo.'

  return {
    mesP25,
    mesMediana,
    mesP75,
    fechaP25: mesP25 === null ? null : addMonths(desde, mesP25),
    fechaMediana: mesMediana === null ? null : addMonths(desde, mesMediana),
    fechaP75: mesP75 === null ? null : addMonths(desde, mesP75),
    simulacionesQueNoLlegan: never,
    probabilidadPct,
    advertencia,
  }
}

// ─── Consistency check (P1-7) ───────────────────────────────────────────────

export type ConsistencyInput = {
  probabilidadPct: number
  aporteActual: number
  aporteSugerido: number | null
  objetivoPct: number
  valorFinalMediana: number
  meta: number
  pesos: number[]
  rendimientoAnual: number
}

export type ConsistencyReport = { consistent: boolean; problems: string[] }

/**
 * Catch a result that contradicts itself before a reader sees it.
 *
 * These are not input validations — every field here is something the engine
 * produced. They exist because the failure mode that damaged trust in the old
 * advisor was not a wrong number, it was two numbers on the same screen that
 * could not both be true.
 */
export function verificarConsistencia(input: ConsistencyInput): ConsistencyReport {
  const problems: string[] = []

  const finite = [
    input.probabilidadPct,
    input.aporteActual,
    input.valorFinalMediana,
    input.meta,
    input.rendimientoAnual,
  ]
  if (finite.some((v) => !Number.isFinite(v))) {
    problems.push('Uno de los resultados no es un numero finito.')
  }

  if (Number.isFinite(input.probabilidadPct)) {
    const probability = validateProbability(input.probabilidadPct, { scale: 'percent' })
    if (!probability.valid) problems.push(probability.reason!)
  }

  const weights = validateWeights(input.pesos)
  if (!weights.valid) problems.push('Cartera sugerida: ' + weights.reason)

  // The signature of the circular advice this engine was rebuilt to remove.
  if (
    input.aporteSugerido !== null &&
    Number.isFinite(input.aporteSugerido) &&
    input.probabilidadPct < input.objetivoPct &&
    input.aporteSugerido < input.aporteActual
  ) {
    problems.push(
      'El aporte sugerido es menor que el actual pero la probabilidad esta por debajo del objetivo: ' +
        'las dos cosas no pueden ser ciertas a la vez.',
    )
  }

  // A median comfortably past the goal cannot coexist with a low probability.
  if (
    Number.isFinite(input.valorFinalMediana) &&
    Number.isFinite(input.meta) &&
    input.valorFinalMediana > input.meta &&
    input.probabilidadPct < 50
  ) {
    problems.push(
      'El escenario mediano supera la meta pero la probabilidad reportada es menor al 50%: por ' +
        'definicion la mitad de los escenarios queda por encima de la mediana.',
    )
  }

  if (
    Number.isFinite(input.valorFinalMediana) &&
    Number.isFinite(input.meta) &&
    input.valorFinalMediana < input.meta &&
    input.probabilidadPct > 50
  ) {
    problems.push(
      'El escenario mediano queda por debajo de la meta pero la probabilidad reportada supera el 50%.',
    )
  }

  // Past this an expected return is a unit error, not an assumption.
  if (Number.isFinite(input.rendimientoAnual) && Math.abs(input.rendimientoAnual) > 1) {
    problems.push(
      'El rendimiento anual esperado (' +
        (input.rendimientoAnual * 100).toFixed(0) +
        '%) esta fuera de cualquier rango razonable; revisa las unidades.',
    )
  }

  return { consistent: problems.length === 0, problems }
}

/** Exposed for callers that need to compare money exactly. */
export const advisorInternals = { toCents }
