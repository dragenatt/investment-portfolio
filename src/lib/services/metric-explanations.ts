// Metric explanations — pure functions, no I/O.
//
// A dashboard full of numbers teaches nothing on its own. "Sharpe 0.82" is only
// information to someone who already knows what a Sharpe ratio is, and for
// everyone else it is decoration that looks authoritative.
//
// E3 asks for five parts per metric, and each one is here: a definition, the
// formula, a worked example, the reader's own result, and an interpretation of
// THAT result. Two rules keep them honest:
//
//   The example is computed, not typed. Every worked example runs through the
//   same engine the app uses — calculateVolatility, historicalVaR, calculateXIRR,
//   effectiveIndependentBets — and the tests recompute them. A hand-written
//   "10% / 15% = 0.67" is right on the day it is written and wrong the day the
//   engine changes.
//
//   The formula is the one the number on screen was computed with. The first
//   version showed Jensen's alpha beside a figure computed with no risk-free
//   rate, and "x sqrt(252)" beside a volatility annualised by the bar cadence.
//
// And one rule from the roadmap: no judgement without a source. "A Sharpe under
// 0.5 is low" has none, so readings are literal, and where a real statistical
// statement exists — the standard error of a Sharpe ratio, from Lo (2002) — it
// replaces the band.

import { recoveryRequired } from './drawdown'
import { calculateVolatility, calculateMaxDrawdown } from './analytics'
import { historicalVaR, conditionalVaR } from './var'
import { calculateXIRR } from './returns'
import { effectiveIndependentBets } from './pca'
import { formatCurrency } from '@/lib/utils/currency'
import { TRADING_DAYS_PER_YEAR } from '@/lib/constants/financial-constants'

export type MetricId =
  | 'return'
  | 'volatility'
  | 'sharpe'
  | 'sortino'
  | 'beta'
  | 'alpha'
  | 'var'
  | 'cvar'
  | 'maxDrawdown'
  | 'trackingError'
  | 'informationRatio'
  | 'hhi'
  | 'effectiveBets'
  | 'xirr'
  | 'twr'

export type MetricContext = {
  benchmarkName?: string
  portfolioValue?: number
  currency?: string
  riskFreeRatePct?: number
  /** Bars per year of the series the metric was computed on (TRADING_DAYS_PER_YEAR daily, 52 weekly, 12 monthly). */
  periodsPerYear?: number
  /** Number of return observations behind the metric. */
  observations?: number
  /** How many positions the book holds. */
  holdings?: number
  /**
   * The risk-free rate alpha was computed with, in percent. Omitted means alpha
   * was computed without one (Rp - beta x Rb), which is what the risk tab does.
   */
  alphaRiskFreePct?: number
  /** The book's own Sharpe ratio, so Sortino can be read against it. */
  sharpe?: number
  /** Size-weighted average age of the invested capital, in days. */
  capitalAgeDays?: number
}

export type WorkedExample = {
  /** The made-up situation, in words and numbers. */
  setup: string
  /** The arithmetic, written out. */
  steps: string
  /** The answer, as a sentence. Always contains `display`. */
  result: string
  value: number
  display: string
}

export type MetricExplanation = {
  id: MetricId
  name: string
  formula: string
  definition: string
  example: WorkedExample
  /** The reader's own value, or null when it could not be computed. */
  value: number | null
  display: string
  /** The reader's own value, read back to them. Never generic. */
  interpretation: string
  /** Where the metric or the reading comes from, when it comes from a named source. */
  source: string | null
}

const NO_VALUE = 'Todavia no hay datos suficientes para calcular esta metrica.'
const EMPTY = '—'

function fmt(value: number, decimals = 2): string {
  return value.toFixed(decimals)
}

function money(value: number, currency?: string): string {
  if (currency) return formatCurrency(Math.abs(value), currency)
  return `$${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Math.abs(value))}`
}

/** Plural noun and adjective for a bar cadence. */
function cadence(periodsPerYear: number | undefined): { bars: string; adjective: string; q: number } {
  const q = periodsPerYear && periodsPerYear > 0 ? periodsPerYear : TRADING_DAYS_PER_YEAR
  if (q >= 200) return { bars: 'dias', adjective: 'diarios', q }
  if (q >= 40) return { bars: 'semanas', adjective: 'semanales', q }
  return { bars: 'meses', adjective: 'mensuales', q }
}

type Unit = 'percent' | 'ratio' | 'hhi' | 'count'

function display(value: number, unit: Unit): string {
  switch (unit) {
    case 'percent':
      return `${fmt(value)}%`
    case 'hhi':
      return fmt(value, 3)
    case 'count':
      return fmt(value, 1)
    default:
      return fmt(value)
  }
}

type Definition = {
  name: string
  unit: Unit
  formula: (ctx: MetricContext) => string
  definition: string
  source: string | null
  read: (value: number, ctx: MetricContext) => string
}

// ─── Worked examples ────────────────────────────────────────────────────────
//
// Computed once, at module load, by the real engines.

function example(
  setup: string,
  steps: string,
  value: number,
  unit: Unit,
  sentence: (shown: string) => string,
): WorkedExample {
  const shown = display(value, unit)
  return { setup, steps, value, display: shown, result: sentence(shown) }
}

const EXAMPLE_DAILY = [0.012, -0.008, 0.005, -0.015, 0.009, 0.003, -0.004, 0.011, -0.007, 0.002]
const EXAMPLE_TAIL_DAYS = [
  1.2, -0.4, 0.8, -2.9, 0.3, -1.1, 0.6, -0.2, 1.5, -3.6, 0.9, -0.7, 0.4, -1.8, 0.1, 0.7, -0.9, 1.1, -0.3, 0.5,
].map((v) => v / 100)
const EXAMPLE_FLOWS = [
  { date: '2025-01-01', amount: -10000 },
  { date: '2025-07-01', amount: -5000 },
  { date: '2026-01-01', amount: 16200 },
]
const EXAMPLE_COV = [
  [0.04, 0.036, 0],
  [0.036, 0.04, 0],
  [0, 0, 0.04],
]
const EXAMPLE_TE_DAILY_PCT = 0.4
const EXAMPLE_SHARPE = (10 - 4) / 15
const EXAMPLE_DRAWDOWN = calculateMaxDrawdown([100, 130, 91, 120])
const EXAMPLE_HHI = 0.5 ** 2 + 0.3 ** 2 + 0.2 ** 2

const EXAMPLES: Record<MetricId, WorkedExample> = {
  return: example(
    'Inviertes 10,000 y un anio despues valen 11,200.',
    '(11,200 - 10,000) / 10,000 = 0.12',
    ((11200 - 10000) / 10000) * 100,
    'percent',
    (v) => `El rendimiento es ${v}.`,
  ),
  volatility: example(
    'Diez rendimientos diarios: +1.2%, -0.8%, +0.5%, -1.5%, +0.9%, +0.3%, -0.4%, +1.1%, -0.7%, +0.2%.',
    // Computed too: this line once said 0.87% by hand. The real figure is 0.90%.
    `Desviacion estandar muestral de los diez = ${fmt((calculateVolatility(EXAMPLE_DAILY) / Math.sqrt(TRADING_DAYS_PER_YEAR)) * 100)}% diario; x raiz(${TRADING_DAYS_PER_YEAR}) para anualizar`,
    calculateVolatility(EXAMPLE_DAILY) * 100,
    'percent',
    (v) => `La volatilidad anualizada es ${v}.`,
  ),
  sharpe: example(
    'Un portafolio rinde 10% al anio con 15% de volatilidad; la tasa libre de riesgo es 4%.',
    '(10 - 4) / 15',
    EXAMPLE_SHARPE,
    'ratio',
    (v) => `El Sharpe es ${v}: ${v} puntos de rendimiento extra por cada punto de volatilidad.`,
  ),
  sortino: example(
    'El mismo portafolio: 10% de rendimiento, 4% de tasa libre, pero su desviacion solo a la baja es 8%.',
    '(10 - 4) / 8',
    (10 - 4) / 8,
    'ratio',
    (v) => `El Sortino es ${v}, mayor que el Sharpe de ${fmt(EXAMPLE_SHARPE)} porque parte de su volatilidad era al alza.`,
  ),
  beta: example(
    'La covarianza diaria entre el portafolio y el indice es 0.0002 y la varianza diaria del indice es 0.00016.',
    '0.0002 / 0.00016',
    0.0002 / 0.00016,
    'ratio',
    (v) => `La beta es ${v}: cuando el indice se mueve 1%, el portafolio tiende a moverse 1.25%.`,
  ),
  alpha: example(
    'Un portafolio con beta 1.2 rinde 14% en un anio en que el indice rinde 10%.',
    '14 - 1.2 x 10 = 14 - 12',
    14 - 1.2 * 10,
    'ratio',
    (v) => `El alpha es ${v} puntos: 12 los explicaba la beta, y 2 son lo que queda.`,
  ),
  var: example(
    'Veinte rendimientos diarios, el peor de ellos -3.6% y el segundo peor -2.9%.',
    'Se ordenan de peor a mejor y se toma el percentil 5',
    (historicalVaR(EXAMPLE_TAIL_DAYS, 95) ?? 0) * 100,
    'percent',
    (v) => `El VaR al 95% es ${v}: en 19 de cada 20 dias la perdida no supero esa cifra.`,
  ),
  cvar: example(
    'Los mismos veinte dias del ejemplo del VaR.',
    'Promedio de los rendimientos que quedan por debajo del VaR al 95%',
    (conditionalVaR(EXAMPLE_TAIL_DAYS, 95) ?? 0) * 100,
    'percent',
    (v) => `El CVaR al 95% es ${v}: lo que en promedio se perdio los dias que si rompieron el umbral.`,
  ),
  maxDrawdown: example(
    'Un portafolio vale 100, sube a 130, cae a 91 y termina en 120.',
    '(130 - 91) / 130',
    EXAMPLE_DRAWDOWN,
    'percent',
    (v) => `El maximo drawdown es ${v}, y recuperarlo exige subir ${fmt(recoveryRequired(EXAMPLE_DRAWDOWN) ?? 0)}% desde 91.`,
  ),
  trackingError: example(
    `La diferencia diaria entre el portafolio y el indice oscila con una desviacion estandar de ${EXAMPLE_TE_DAILY_PCT}%.`,
    `${EXAMPLE_TE_DAILY_PCT} x raiz(${TRADING_DAYS_PER_YEAR})`,
    EXAMPLE_TE_DAILY_PCT * Math.sqrt(TRADING_DAYS_PER_YEAR),
    'percent',
    (v) => `El tracking error es ${v}: en un anio tipico el portafolio se separa del indice mas o menos esa cantidad.`,
  ),
  informationRatio: example(
    `El portafolio tiene 2 puntos de alpha y un tracking error de ${fmt(EXAMPLE_TE_DAILY_PCT * Math.sqrt(TRADING_DAYS_PER_YEAR))}%.`,
    `2 / ${fmt(EXAMPLE_TE_DAILY_PCT * Math.sqrt(TRADING_DAYS_PER_YEAR))}`,
    2 / (EXAMPLE_TE_DAILY_PCT * Math.sqrt(TRADING_DAYS_PER_YEAR)),
    'ratio',
    (v) => `El information ratio es ${v}: cada punto de separacion del indice pago esa fraccion de punto de alpha.`,
  ),
  hhi: example(
    'Un portafolio con 50% en una posicion, 30% en otra y 20% en una tercera.',
    '0.5² + 0.3² + 0.2² = 0.25 + 0.09 + 0.04',
    EXAMPLE_HHI,
    'hhi',
    (v) => `El HHI es ${v}, equivalente a ${fmt(1 / EXAMPLE_HHI, 1)} posiciones del mismo tamano aunque haya 3.`,
  ),
  effectiveBets: example(
    'Tres activos con la misma volatilidad: dos con correlacion 0.9 entre si y un tercero independiente.',
    'Autovalores de la covarianza -> proporciones p -> exp(-suma p x ln p)',
    effectiveIndependentBets(EXAMPLE_COV) ?? 0,
    'count',
    (v) => `Hay ${v} apuestas independientes efectivas: los dos activos correlacionados cuentan casi como uno.`,
  ),
  xirr: example(
    'Aportas 10,000 el 1 de enero de 2025, otros 5,000 el 1 de julio, y el 1 de enero de 2026 todo vale 16,200.',
    'Se busca la tasa r que hace -10,000 - 5,000/(1+r)^0.5 + 16,200/(1+r)^1 = 0',
    calculateXIRR(EXAMPLE_FLOWS) ?? 0,
    'percent',
    (v) => `El XIRR es ${v} anual. Ganaste 1,200 sobre 15,000, pero 5,000 solo estuvieron medio anio invertidos.`,
  ),
  twr: example(
    'Un primer periodo rinde +10% y el segundo -5%, sin importar cuanto dinero entro en cada uno.',
    '(1.10 x 0.95) - 1',
    (1.1 * 0.95 - 1) * 100,
    'percent',
    (v) => `El TWR es ${v}.`,
  ),
}

// ─── Definitions ────────────────────────────────────────────────────────────

const DEFINITIONS: Record<MetricId, Definition> = {
  return: {
    name: 'Rendimiento',
    unit: 'percent',
    formula: () => '(Valor final - Valor inicial) / Valor inicial',
    definition:
      'Cuanto crecio o cayo el valor de la inversion en el periodo, expresado como porcentaje de lo que valia al principio.',
    source: null,
    read: (v) =>
      v >= 0
        ? `Tu ${fmt(v)}% significa que cada 100 invertidos se convirtieron en ${fmt(100 + v)}.`
        : `Tu ${fmt(v)}% significa que cada 100 invertidos quedaron en ${fmt(100 + v)}.`,
  },

  volatility: {
    name: 'Volatilidad',
    unit: 'percent',
    formula: () => 'sigma = desviacion estandar de los rendimientos x raiz(periodos por ano)',
    definition:
      'Que tanto se mueve el valor de la inversion, hacia arriba y hacia abajo. No mide perdidas: mide inestabilidad, y una subida brusca cuenta igual que una caida.',
    source: null,
    read: (v, ctx) => {
      const { adjective, q } = cadence(ctx.periodsPerYear)
      return (
        `Tu ${fmt(v)}% anual sale de rendimientos ${adjective} (x raiz(${q})). ` +
        `Si los rendimientos fueran normales, en unos 2 de cada 3 anios el resultado quedaria a menos de ${fmt(v)} puntos del promedio; en la practica las colas son mas gordas y los anios extremos llegan mas seguido de lo que eso sugiere.`
      )
    },
  },

  sharpe: {
    name: 'Sharpe',
    unit: 'ratio',
    formula: () => 'Sharpe = (Rp - Rf) / sigma, con Rp y sigma anualizados',
    definition:
      'Cuanto rendimiento obtienes por encima de la tasa libre de riesgo por cada unidad de volatilidad que corres.',
    source: 'Sharpe (1994), Journal of Portfolio Management; error estandar segun Lo (2002), Financial Analysts Journal',
    read: (v, ctx) => {
      const rf = ctx.riskFreeRatePct !== undefined ? ` (tasa libre de riesgo: ${fmt(ctx.riskFreeRatePct)}%)` : ''
      const literal =
        v < 0
          ? `Tu ${fmt(v)} es negativo${rf}: el portafolio rindio menos que la tasa libre de riesgo, asi que el riesgo que corriste no se pago.`
          : `Tu ${fmt(v)} significa que obtuviste ${fmt(v)} puntos de rendimiento por encima de la tasa libre${rf} por cada punto de volatilidad.`

      // Lo (2002): for IID returns the standard error of an annualised Sharpe
      // estimated from T bars at q per year is sqrt((q + SR^2 / 2) / T).
      const q = ctx.periodsPerYear
      const T = ctx.observations
      if (!q || !T || q <= 0 || T < 2) {
        return `${literal} Sin saber cuanto historial lo respalda no se puede decir que tan preciso es.`
      }
      const se = Math.sqrt((q + (v * v) / 2) / T)
      const years = T / q
      return (
        `${literal} Con ${T} observaciones (${fmt(years, 1)} anios), su error estandar es ${fmt(se)} (Lo, 2002): ` +
        `el intervalo de 95% va de ${fmt(v - 1.96 * se)} a ${fmt(v + 1.96 * se)}. ` +
        (v - 1.96 * se <= 0 && v + 1.96 * se >= 0
          ? 'Ese intervalo incluye el cero, asi que con este historial no se distingue de un portafolio sin ninguna ventaja sobre la tasa libre.'
          : 'Ese intervalo no incluye el cero.')
      )
    },
  },

  sortino: {
    name: 'Sortino',
    unit: 'ratio',
    formula: () => 'Sortino = (Rp - Rf) / sigma_bajista, con sigma_bajista = raiz(promedio de min(0, r - objetivo)²)',
    definition:
      'Como el Sharpe, pero solo cuenta como riesgo los movimientos por debajo del objetivo. Parte de la idea de que la volatilidad al alza no es un problema que haga falta penalizar.',
    source: 'Sortino y Price (1994), Journal of Investing',
    read: (v, ctx) => {
      if (v < 0) {
        return `Tu ${fmt(v)} negativo indica que el portafolio no supero la tasa libre de riesgo aun contando solo las caidas.`
      }
      const sharpe = ctx.sharpe
      if (sharpe === undefined || !Number.isFinite(sharpe) || sharpe <= 0) {
        return `Tu ${fmt(v)} mide el rendimiento por unidad de riesgo a la baja. Si es notablemente mayor que tu Sharpe, tus movimientos bruscos han sido mas al alza que a la baja.`
      }
      // Same numerator, so the ratio of the two is the ratio of the two risks:
      // total volatility over downside deviation.
      const ratio = v / sharpe
      return (
        `Tu ${fmt(v)} es ${fmt(ratio)} veces tu Sharpe de ${fmt(sharpe)}. Como ambos tienen el mismo numerador, eso significa que tu volatilidad total es ${fmt(ratio)} veces tu volatilidad a la baja: ` +
        (ratio > 1
          ? 'una parte de lo que la volatilidad castiga fueron subidas.'
          : 'tus caidas pesan tanto como toda tu volatilidad.')
      )
    },
  },

  beta: {
    name: 'Beta',
    unit: 'ratio',
    formula: () => 'Beta = Cov(Rp, Rb) / Var(Rb)',
    definition:
      'Cuanto se mueve tu portafolio cuando se mueve el indice de referencia. Es sensibilidad, no calidad: una beta alta no es mejor ni peor, es mas movimiento.',
    source: null,
    read: (v, ctx) => {
      const bench = ctx.benchmarkName ?? 'el benchmark'
      if (v > 1.1) {
        return `Tu ${fmt(v)} amplifica ${bench}: cuando sube 1%, tu portafolio ha tendido a subir cerca de ${fmt(v)}% — y cuando baja, tambien baja mas.`
      }
      if (v < 0.9) {
        return `Tu ${fmt(v)} amortigua ${bench}: cuando se mueve 1%, tu portafolio ha tendido a moverse ${fmt(v)}%, en ambas direcciones.`
      }
      return `Tu ${fmt(v)} sigue de cerca a ${bench}: te mueves practicamente con el indice.`
    },
  },

  alpha: {
    name: 'Alpha',
    unit: 'ratio',
    formula: (ctx) =>
      ctx.alphaRiskFreePct === undefined
        ? 'Alpha = Rp - beta x Rb (anualizados, sin tasa libre de riesgo)'
        : 'Alpha = Rp - [Rf + beta x (Rb - Rf)] (alpha de Jensen)',
    definition:
      'El rendimiento que queda despues de descontar lo que la beta ya explicaba. Un portafolio con beta 1.5 en un mercado al alza gana mucho sin tener nada de alpha: ese rendimiento lo produjo el riesgo de mercado, no la seleccion.',
    source: 'Jensen (1968), Journal of Finance',
    read: (v, ctx) => {
      const bench = ctx.benchmarkName ?? 'el benchmark'
      const note =
        ctx.alphaRiskFreePct === undefined
          ? ' Aqui se calcula sin tasa libre de riesgo; con una tasa, el alpha de Jensen cambia en Rf x (1 - beta).'
          : ''
      return v >= 0
        ? `Tu ${fmt(v)} puntos anuales es lo que tu portafolio rindio por encima de lo que su beta frente a ${bench} ya justificaba.${note}`
        : `Tu ${fmt(v)} puntos anuales indica que el portafolio rindio menos de lo que su beta frente a ${bench} hacia esperar.${note}`
    },
  },

  var: {
    name: 'VaR (Valor en Riesgo)',
    unit: 'percent',
    formula: () => 'VaR_95 = perdida en el percentil 5 de los rendimientos historicos',
    definition:
      'La perdida que no se supero en 95 de cada 100 periodos observados. Es un umbral, no un techo: no dice nada sobre que tan mal fue el 5% restante.',
    source: null,
    read: (v, ctx) => {
      const { bars } = cadence(ctx.periodsPerYear)
      if (ctx.portfolioValue && ctx.portfolioValue > 0) {
        const amount = (ctx.portfolioValue * v) / 100
        return `Tu ${fmt(v)}% equivale a unos ${money(amount, ctx.currency)} sobre el valor actual. En 1 de cada 20 ${bars} la perdida supero esa cifra.`
      }
      return `Tu ${fmt(v)}% es la perdida que no se supero en 19 de cada 20 ${bars}. Mira tambien el CVaR: este numero no dice que tan mal fue el vigesimo.`
    },
  },

  cvar: {
    name: 'CVaR (Perdida esperada)',
    unit: 'percent',
    formula: () => 'CVaR_95 = promedio de los rendimientos peores que el VaR_95',
    definition:
      'El promedio de las perdidas en los periodos que si superan el VaR. Si el VaR dice a que distancia esta el borde del acantilado, el CVaR dice que tan honda es la caida.',
    source: 'Rockafellar y Uryasev (2000), Journal of Risk',
    read: (v, ctx) => {
      const { bars } = cadence(ctx.periodsPerYear)
      if (ctx.portfolioValue && ctx.portfolioValue > 0) {
        const amount = (ctx.portfolioValue * v) / 100
        return `Tu ${fmt(v)}% equivale a unos ${money(amount, ctx.currency)}: es lo que en promedio se perdio en los peores ${bars}, y es la cifra con la que conviene planear.`
      }
      return `Tu ${fmt(v)}% es la perdida promedio en los peores ${bars}. Siempre es igual o mayor que el VaR, por definicion.`
    },
  },

  maxDrawdown: {
    name: 'Maximo drawdown',
    unit: 'percent',
    formula: () => 'max((Pico - Valle) / Pico)',
    definition:
      'La peor caida desde un maximo hasta el fondo siguiente. Mide lo que un inversionista habria tenido que aguantar sin vender.',
    source: null,
    read: (v) => {
      const recovery = recoveryRequired(Math.abs(v))
      if (recovery === null) {
        return `Tu ${fmt(v)}% describe una perdida total o cercana: no hay ganancia que la recupere.`
      }
      return `Tu ${fmt(Math.abs(v))}% necesita una ganancia de ${fmt(recovery)}% para volver al punto de partida, no de ${fmt(Math.abs(v))}%: la subida trabaja sobre el saldo mas pequeno que dejo la caida.`
    },
  },

  trackingError: {
    name: 'Tracking error',
    unit: 'percent',
    formula: () => 'TE = desviacion estandar(Rp - Rb) x raiz(periodos por ano)',
    definition:
      'Que tanto se separa tu portafolio del indice en un anio tipico. No es un error que estes cometiendo: un tracking error pequeno solo significa que te pareces al indice.',
    source: null,
    read: (v, ctx) => {
      const bench = ctx.benchmarkName ?? 'el benchmark'
      return `Tu ${fmt(v)}% significa que, en un anio tipico, tu rendimiento queda a mas o menos ${fmt(v)} puntos del de ${bench}. Mayor no es peor: es cuanto te separas, para bien o para mal.`
    },
  },

  informationRatio: {
    name: 'Information ratio',
    unit: 'ratio',
    formula: () => 'IR = Alpha / Tracking error',
    definition:
      'Si el tracking error mide cuanto te alejas del indice, el information ratio responde si alejarte valio la pena. Aqui se usa el alpha en el numerador; otras fuentes usan el rendimiento activo (Rp - Rb).',
    source: null,
    read: (v) =>
      v > 0
        ? `Tu ${fmt(v)} significa que cada punto de separacion del indice te dio ${fmt(v)} puntos de alpha.`
        : v < 0
          ? `Tu ${fmt(v)} significa que separarte del indice te costo: cada punto de separacion resto ${fmt(Math.abs(v))} puntos de alpha.`
          : `Tu ${fmt(v)} significa que separarte del indice no te dio ni te quito alpha.`,
  },

  hhi: {
    name: 'HHI (concentracion)',
    unit: 'hhi',
    formula: () => 'HHI = suma de los pesos al cuadrado',
    definition:
      'Que tan concentrado esta el portafolio por peso. Vale 1 si todo esta en una sola posicion y 1/N si esta repartido en partes iguales entre N.',
    source: null,
    read: (v, ctx) => {
      const equivalent = v > 0 ? 1 / v : 0
      const reading = `Tu ${fmt(v, 3)} significa que tu dinero se concentra como si tuvieras ${fmt(equivalent, 1)} posiciones del mismo tamano.`
      if (!ctx.holdings || ctx.holdings <= 0) return reading
      // Literal, not graded: the share of the positions held that the weights
      // are "worth". No threshold decides what counts as concentrated.
      return `${reading} Tienes ${ctx.holdings} posiciones, asi que por peso tu cartera equivale al ${fmt((equivalent / ctx.holdings) * 100, 0)}% de ellas.`
    },
  },

  effectiveBets: {
    name: 'Apuestas independientes efectivas',
    unit: 'count',
    formula: () => 'N_eff = exp(-suma p_i x ln p_i), con p_i = autovalor_i / suma de autovalores de la covarianza',
    definition:
      'Cuantas fuentes de riesgo realmente distintas tienes. Diez posiciones que se mueven juntas son una sola apuesta repetida diez veces, y el HHI no lo detecta porque solo mira pesos.',
    source: 'Meucci (2009), Risk',
    read: (v, ctx) => {
      const lead =
        ctx.holdings && ctx.holdings > 0
          ? `Con ${ctx.holdings} posiciones tienes unas ${fmt(v, 1)} apuestas realmente independientes`
          : `Tienes unas ${fmt(v, 1)} apuestas realmente independientes`
      return v < 2
        ? `${lead}: en la practica, casi todo tu riesgo viene de una sola fuente.`
        : `${lead}. La diferencia entre las dos cifras es cuanto se mueven juntos tus activos.`
    },
  },

  xirr: {
    name: 'XIRR / rendimiento del inversionista',
    unit: 'percent',
    formula: () => 'La tasa r que hace que la suma de flujo / (1+r)^t sea cero',
    definition:
      'Tu rendimiento real considerando cuando y cuanto aportaste. Si metiste mas dinero justo antes de una buena racha, este numero lo recoge; el momento de cada aportacion importa aqui.',
    source: null,
    read: (v, ctx) => {
      const base = `Tu ${fmt(v)}% anual es lo que efectivamente rindio TU dinero, dado el momento en que lo pusiste. Comparalo con el TWR: si son distintos, la diferencia es el efecto del timing de tus aportaciones.`
      const age = ctx.capitalAgeDays
      if (age === undefined || !Number.isFinite(age) || age >= 365) return base
      // No threshold here beyond "less than the year the rate is quoted for":
      // below that, the figure is a shorter return raised to a year.
      return (
        `${base} Pero tu dinero lleva en promedio ${Math.round(age)} dias invertido, y una tasa anual sobre menos de un ano extrapola: ` +
        `supone que lo ocurrido en esos ${Math.round(age)} dias se repite hasta completar el ano. Tomalo como velocidad, no como resultado.`
      )
    },
  },

  twr: {
    name: 'TWR / rendimiento de la estrategia',
    unit: 'percent',
    formula: () => 'TWR = producto de (1 + Ri) de cada subperiodo - 1',
    definition:
      'El rendimiento de la estrategia aislando el efecto de tus aportaciones y retiros. Es el numero comparable contra un indice, porque un indice tampoco recibe flujos.',
    source: null,
    read: (v) =>
      `Tu ${fmt(v)}% es lo que rindio la estrategia en si, independientemente de cuando aportaste. Es el numero que debes comparar contra un benchmark.`,
  },
}

export const METRIC_IDS = Object.keys(DEFINITIONS) as MetricId[]

/**
 * Explain one metric using the reader's own value.
 *
 * A non-finite value produces the "not enough data" reading rather than leaking
 * NaN into a sentence — the one thing an explanation must never do is teach
 * someone to distrust the explanation.
 */
export function explainMetric(
  id: MetricId,
  value: number | null | undefined,
  context: MetricContext = {},
): MetricExplanation | null {
  const definition = DEFINITIONS[id]
  if (!definition) return null

  const usable = typeof value === 'number' && Number.isFinite(value)

  return {
    id,
    name: definition.name,
    formula: definition.formula(context),
    definition: definition.definition,
    example: EXAMPLES[id],
    value: usable ? (value as number) : null,
    display: usable ? display(value as number, definition.unit) : EMPTY,
    interpretation: usable ? definition.read(value as number, context) : NO_VALUE,
    source: definition.source,
  }
}

/** Every metric explained at once, for a page that wants the whole glossary. */
export function explainAll(
  values: Partial<Record<MetricId, number | null>>,
  context: MetricContext = {},
): MetricExplanation[] {
  return METRIC_IDS.map((id) => explainMetric(id, values[id] ?? null, context)!).filter(Boolean)
}
