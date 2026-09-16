// Financial laboratory — pure functions, no I/O.
//
// Every other module in this codebase answers a question about the user's own
// portfolio. This one answers questions about how investing works, using
// deliberately synthetic inputs the reader can turn up and down until the shape
// of the relationship becomes obvious.
//
// The reason it is worth building separately: a lesson about diversification
// delivered through someone's real portfolio is confounded by everything else
// in that portfolio. Here the reader can set the correlation to exactly 1, see
// the benefit vanish entirely, set it to -1 and see the risk go to zero — and
// those two extremes are what make the middle intelligible.
//
// Every experiment composes engines that already exist. None of the mathematics
// here is a second implementation of anything.
//
// Each experiment carries the seven parts E1 asks for: objective, concept,
// parameters, simulation, result, interpretation and questions. The first four
// and the last are data on the experiment; result and interpretation come out
// of running it. The result also describes its own chart, so the page can draw
// all of them with one component instead of twelve.

import { portfolioVolatility, riskContributions } from './risk-attribution'
import { parametricVaR, cornishFisherVaR } from './var'
import { recoveryRequired } from './drawdown'
import { buildScenarios, evaluarPlan } from './advisor'
import { formatoMoneda } from '@/lib/utils/money'
import { efficientFrontier, portfolioRiskReturn } from './optimizer'
import { riskParityWeights } from './allocation-strategies'
import { runFactorRegression } from './factors'
import { runStrategy } from './strategy-engine'
import type { Strategy } from './strategy-rule'
import type { Bar } from './backtest'
import { mulberry32, standardNormal } from '@/lib/utils/random'
import { isEnabled, type FeatureFlag } from './feature-flags'
import { TRADING_DAYS_PER_YEAR as TRADING_DAYS } from '@/lib/constants/financial-constants'


export type Unit = 'number' | 'percent' | 'money' | 'years' | 'pp'

export type ParamSpec = {
  key: string
  label: string
  min: number
  max: number
  step: number
  default: number
  /** How the value should be shown: a raw number, a percentage, or money. */
  unit: 'number' | 'percent' | 'money' | 'years'
}

export type ExperimentId =
  | 'diversification'
  | 'correlation'
  | 'volatility'
  | 'riskReturn'
  | 'monteCarlo'
  | 'var'
  | 'beta'
  | 'drawdown'
  | 'rebalancing'
  | 'markowitz'
  | 'riskParity'
  | 'stressTesting'
  | 'backtesting'
  | 'factors'

/** What to draw. Every key named here exists on every row of the series. */
export type ChartSpec = {
  kind: 'line' | 'bar'
  x: string
  xLabel: string
  xUnit: Unit
  /** Labels for a categorical x axis, one per row, in row order. */
  xCategories?: string[]
  series: Array<{ key: string; label: string; unit: Unit }>
  /** A horizontal line worth drawing — zero, or the true value being estimated. */
  referenceY?: { value: number; label: string }
}

export type ExperimentResult = {
  /** Rows the interface can chart or tabulate directly. */
  series: Array<Record<string, number>>
  chart: ChartSpec
  /** Headline numbers worth pulling out of the series. */
  highlights: Array<{ label: string; value: string }>
  interpretation: string
}

export type Experiment = {
  id: ExperimentId
  title: string
  objective: string
  concept: string
  params: ParamSpec[]
  /** What the run actually computes, in words — the "simulación" step. */
  simulation: string
  questions: string[]
  /** False when the experiment is switched off. */
  available: boolean
  /** Why it is unavailable, when it is. */
  unavailableReason?: string
  run?: (params: Record<string, number>) => ExperimentResult
}

function param(
  key: string,
  label: string,
  min: number,
  max: number,
  step: number,
  def: number,
  unit: ParamSpec['unit'] = 'number',
): ParamSpec {
  return { key, label, min, max, step, default: def, unit }
}

/** Clamp an incoming value into its declared range, so a bad input cannot break a lesson. */
function read(params: Record<string, number>, spec: ParamSpec): number {
  const raw = params[spec.key]
  if (!Number.isFinite(raw)) return spec.default
  return Math.min(spec.max, Math.max(spec.min, raw))
}

/** Equal-weight covariance matrix from one volatility and one shared correlation. */
function uniformCov(n: number, volatility: number, correlation: number): number[][] {
  return Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) =>
      i === j ? volatility * volatility : volatility * volatility * correlation,
    ),
  )
}

/** Covariance from a list of volatilities and one shared correlation. */
function covFromVolatilities(volatilities: number[], correlation: number): number[][] {
  return volatilities.map((vi, i) =>
    volatilities.map((vj, j) => (i === j ? vi * vi : vi * vj * correlation)),
  )
}

const pct = (value: number, digits = 1) => `${value.toFixed(digits)}%`
const signed = (value: number, digits = 1) => `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`
const money = formatoMoneda

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

// ─── Parameters ─────────────────────────────────────────────────────────────

const DIVERSIFICATION_PARAMS = [
  param('assets', 'Numero de activos', 1, 30, 1, 10),
  param('volatility', 'Volatilidad de cada activo', 5, 60, 1, 20, 'percent'),
  // Not negative. One correlation shared by N assets cannot go below -1/(N-1):
  // at 30 assets and -0.5 the "covariance matrix" has negative variance, the
  // volatility comes back null, and the old `?? 0` drew it as a portfolio with
  // zero risk. Two-asset negative correlation is the next experiment's job.
  param('correlation', 'Correlacion entre ellos', 0, 1, 0.05, 0.2),
]

const CORRELATION_PARAMS = [
  param('volatilityA', 'Volatilidad del activo A', 5, 60, 1, 25, 'percent'),
  param('volatilityB', 'Volatilidad del activo B', 5, 60, 1, 15, 'percent'),
  param('weightA', 'Peso del activo A', 0, 100, 5, 50, 'percent'),
]

const VOLATILITY_PARAMS = [
  param('meanReturn', 'Rendimiento promedio anual', 0, 20, 0.5, 8, 'percent'),
  param('lowVolatility', 'Volatilidad baja', 0, 40, 1, 10, 'percent'),
  param('highVolatility', 'Volatilidad alta', 0, 60, 1, 30, 'percent'),
  param('years', 'Horizonte', 2, 40, 2, 20, 'years'),
]

const RISK_RETURN_PARAMS = [
  param('riskyReturn', 'Rendimiento del activo riesgoso', 0, 25, 0.5, 12, 'percent'),
  param('riskyVolatility', 'Volatilidad del activo riesgoso', 5, 60, 1, 25, 'percent'),
  param('safeReturn', 'Rendimiento del activo seguro', 0, 15, 0.5, 4, 'percent'),
  param('safeVolatility', 'Volatilidad del activo seguro', 0, 20, 0.5, 3, 'percent'),
  param('correlation', 'Correlacion entre ambos', -1, 1, 0.1, 0.1),
]

const MONTE_CARLO_PARAMS = [
  param('capital', 'Capital inicial', 0, 1_000_000, 10_000, 100_000, 'money'),
  param('monthly', 'Aportacion mensual', 0, 50_000, 500, 5_000, 'money'),
  param('years', 'Horizonte', 1, 40, 1, 20, 'years'),
  param('expectedReturn', 'Rendimiento esperado', 0, 20, 0.5, 8, 'percent'),
  param('volatility', 'Volatilidad anual', 0, 40, 1, 15, 'percent'),
]

const VAR_PARAMS = [
  param('volatility', 'Volatilidad diaria', 0.2, 5, 0.1, 1.2, 'percent'),
  param('skew', 'Asimetria de los retornos', -2, 2, 0.1, -0.6),
  param('kurtosis', 'Exceso de curtosis (colas gordas)', 0, 10, 0.5, 3),
]

const BETA_PARAMS = [
  param('beta', 'Beta del portafolio', -1, 2.5, 0.1, 1.3),
  param('marketMove', 'Movimiento del mercado', -40, 40, 1, -20, 'percent'),
]

const DRAWDOWN_PARAMS = [param('maxDrawdown', 'Caida maxima', 1, 95, 1, 40, 'percent')]

const MARKOWITZ_PARAMS = [
  param('returnA', 'Rendimiento esperado del activo A', 0, 25, 0.5, 12, 'percent'),
  param('volatilityA', 'Volatilidad del activo A', 5, 60, 1, 25, 'percent'),
  param('returnB', 'Rendimiento esperado del activo B', 0, 25, 0.5, 6, 'percent'),
  param('volatilityB', 'Volatilidad del activo B', 2, 40, 1, 10, 'percent'),
  param('correlation', 'Correlacion entre ambos', -1, 1, 0.1, 0.2),
]

const RISK_PARITY_PARAMS = [
  param('equityVolatility', 'Volatilidad de las acciones', 5, 40, 1, 18, 'percent'),
  param('bondVolatility', 'Volatilidad de los bonos', 1, 20, 0.5, 5, 'percent'),
  param('commodityVolatility', 'Volatilidad de las materias primas', 5, 50, 1, 22, 'percent'),
  // Three assets sharing one correlation stay a valid matrix down to -0.5.
  param('correlation', 'Correlacion entre los tres', -0.3, 0.9, 0.05, 0.2),
]

const STRESS_PARAMS = [
  param('assets', 'Numero de activos', 2, 30, 1, 10),
  param('volatility', 'Volatilidad normal de cada activo', 5, 40, 1, 18, 'percent'),
  param('calmCorrelation', 'Correlacion en calma', 0, 0.9, 0.05, 0.2),
  param('crisisCorrelation', 'Correlacion en crisis', 0, 1, 0.05, 0.8),
  param('crisisMultiplier', 'Cuanto se multiplica la volatilidad en crisis', 1, 4, 0.25, 2),
]

const BACKTEST_PARAMS = [
  param('paths', 'Caminos de precios simulados', 10, 60, 1, 30),
  param('fastWindow', 'Media corta (dias)', 5, 50, 5, 20),
  param('slowWindow', 'Media larga (dias)', 20, 200, 10, 50),
  param('drift', 'Tendencia anual del precio', -10, 20, 1, 7, 'percent'),
  param('volatility', 'Volatilidad anual del precio', 5, 60, 1, 20, 'percent'),
  param('costPct', 'Costo por operacion', 0, 1, 0.05, 0.1, 'percent'),
]

const FACTOR_PARAMS = [
  param('marketBeta', 'Beta real al mercado', 0, 2, 0.1, 1.1),
  param('sizeLoading', 'Exposicion real a tamano', -1, 1, 0.1, 0.3),
  param('alpha', 'Alfa real anual', -5, 5, 0.5, 0, 'percent'),
  param('idiosyncraticVolatility', 'Volatilidad propia (no explicada)', 2, 40, 1, 15, 'percent'),
  param('factorVolatility', 'Volatilidad de los factores', 5, 30, 1, 15, 'percent'),
  param('years', 'Anos de historial', 1, 20, 1, 5, 'years'),
]

const REBALANCING_PARAMS = [
  param('riskyWeight', 'Peso objetivo del activo riesgoso', 10, 90, 5, 60, 'percent'),
  param('riskyVolatility', 'Volatilidad del activo riesgoso', 5, 60, 1, 25, 'percent'),
  param('safeVolatility', 'Volatilidad del activo seguro', 0, 20, 0.5, 4, 'percent'),
  param('drift', 'Cuanto se ha desviado el peso', -30, 30, 1, 15, 'percent'),
]

/** Two years of trading days per simulated price path in the backtesting lesson. */
const BACKTEST_BARS = 2 * TRADING_DAYS
const BACKTEST_SEED = 7_000
const FACTOR_SEED = 31_415
/** Sample lengths the alpha band is re-estimated at, in years. */
const FACTOR_HORIZONS = [0.25, 0.5, 1, 2, 3, 5, 10, 15, 20]

// ─── Experiments ────────────────────────────────────────────────────────────
//
// Ordered as E1 lists them. The two that E1 does not name — risk versus return
// and the asymmetry of losses — predate it and come last.

const EXPERIMENTS: Experiment[] = [
  {
    id: 'diversification',
    title: 'Diversificacion',
    objective: 'Ver cuanto riesgo desaparece al repartir, y donde deja de desaparecer.',
    concept:
      'El riesgo de un portafolio no es el promedio del riesgo de sus partes. Cuando los activos no se mueven exactamente igual, parte de sus movimientos se cancelan entre si. Lo que NO se cancela es el riesgo que comparten todos.',
    params: DIVERSIFICATION_PARAMS,
    simulation:
      'Para cada numero de activos de 1 al maximo, se arma un portafolio con el mismo peso en cada uno, todos con la misma volatilidad y la misma correlacion entre si, y se calcula su volatilidad como la raiz de w·Σ·w.',
    questions: [
      'Con correlacion 0, cuantos activos hacen falta para bajar el riesgo a la mitad?',
      'Que pasa con la curva cuando pones la correlacion en 1? Por que?',
      'A partir de cuantos activos deja de notarse el beneficio de agregar uno mas?',
    ],
    available: true,
    run: (input) => {
      const maxAssets = Math.round(read(input, DIVERSIFICATION_PARAMS[0]))
      const vol = read(input, DIVERSIFICATION_PARAMS[1]) / 100
      const correlation = read(input, DIVERSIFICATION_PARAMS[2])

      const series: Array<Record<string, number>> = []
      for (let n = 1; n <= maxAssets; n++) {
        const weights = Array(n).fill(1 / n)
        const sigma = portfolioVolatility(weights, uniformCov(n, vol, correlation))
        series.push({
          assets: n,
          portfolioVolatility: (sigma ?? 0) * 100,
          singleAssetVolatility: vol * 100,
        })
      }

      const last = series[series.length - 1]
      // With N assets sharing one correlation, volatility tends to
      // sigma x sqrt(correlation) however many you add. That floor is the point.
      const floor = correlation > 0 ? vol * Math.sqrt(correlation) * 100 : 0

      return {
        series,
        chart: {
          kind: 'line',
          x: 'assets',
          xLabel: 'Numero de activos',
          xUnit: 'number',
          series: [
            { key: 'portfolioVolatility', label: 'Riesgo del portafolio', unit: 'percent' },
            { key: 'singleAssetVolatility', label: 'Riesgo de un solo activo', unit: 'percent' },
          ],
        },
        highlights: [
          { label: 'Riesgo de un solo activo', value: pct(vol * 100) },
          { label: `Riesgo con ${maxAssets} activos`, value: pct(last.portfolioVolatility) },
          { label: 'Piso teorico', value: pct(floor) },
        ],
        interpretation:
          correlation >= 0.99
            ? 'Con correlacion 1 la curva es plana: agregar activos no reduce nada, porque todos se mueven a la vez. Diversificar no es tener muchas cosas, es tener cosas que no se muevan juntas.'
            : `Repartir entre ${maxAssets} activos baja el riesgo de ${pct(vol * 100)} a ${pct(last.portfolioVolatility)}, pero la curva se aplana rapido. Por mas activos que agregues no bajaras de ${pct(floor)}: ese piso es el riesgo que todos comparten y que ninguna diversificacion elimina.`,
      }
    },
  },

  {
    id: 'correlation',
    title: 'Correlacion',
    objective: 'Ver que la correlacion, y no el numero de activos, es lo que decide el beneficio.',
    concept:
      'Dos activos con la misma volatilidad pueden dar un portafolio muy riesgoso o casi sin riesgo, dependiendo solo de como se muevan uno respecto al otro.',
    params: CORRELATION_PARAMS,
    simulation:
      'Con los dos activos y los pesos fijos, se recorre la correlacion de -1 a +1 en pasos de 0.1 y en cada paso se calcula la volatilidad del portafolio. Se dibuja junto al promedio ponderado de las dos volatilidades, que es el riesgo si no hubiera ninguna diversificacion.',
    questions: [
      'Con correlacion -1, que peso hace que el riesgo llegue a cero?',
      'Por que la curva no es una linea recta entre -1 y 1?',
      'En la practica, que tan facil es encontrar activos con correlacion negativa?',
    ],
    available: true,
    run: (input) => {
      const volA = read(input, CORRELATION_PARAMS[0]) / 100
      const volB = read(input, CORRELATION_PARAMS[1]) / 100
      const wA = read(input, CORRELATION_PARAMS[2]) / 100
      const weights = [wA, 1 - wA]

      const series: Array<Record<string, number>> = []
      for (let step = -10; step <= 10; step++) {
        const correlation = step / 10
        const sigma = portfolioVolatility(weights, covFromVolatilities([volA, volB], correlation))
        series.push({
          correlation,
          portfolioVolatility: (sigma ?? 0) * 100,
          weightedAverage: (wA * volA + (1 - wA) * volB) * 100,
        })
      }

      const atMinusOne = series[0].portfolioVolatility
      const atOne = series[series.length - 1].portfolioVolatility

      return {
        series,
        chart: {
          kind: 'line',
          x: 'correlation',
          xLabel: 'Correlacion',
          xUnit: 'number',
          series: [
            { key: 'portfolioVolatility', label: 'Riesgo del portafolio', unit: 'percent' },
            { key: 'weightedAverage', label: 'Promedio ponderado (sin diversificar)', unit: 'percent' },
          ],
        },
        highlights: [
          { label: 'Riesgo con correlacion -1', value: pct(atMinusOne, 2) },
          { label: 'Riesgo con correlacion +1', value: pct(atOne, 2) },
          { label: 'Promedio ponderado', value: pct(series[0].weightedAverage, 2) },
        ],
        interpretation:
          `Con los mismos dos activos y los mismos pesos, el riesgo del portafolio va de ${pct(atMinusOne, 2)} a ${pct(atOne, 2)} dependiendo unicamente de la correlacion. ` +
          'En el extremo +1 el riesgo iguala al promedio ponderado: no hay ningun beneficio. Todo lo que ganas al diversificar sale de esa diferencia.',
      }
    },
  },

  {
    id: 'volatility',
    title: 'Volatilidad',
    objective:
      'Ver que dos inversiones con el mismo rendimiento promedio terminan en lugares distintos si una se mueve mas.',
    concept:
      'El rendimiento que se compone no es el promedio. Ganar 30% y luego perder 30% no te deja igual: te deja con 91 de cada 100, porque la perdida trabaja sobre un saldo mas grande que la ganancia. Cuanto mas oscila una inversion, mas se aleja lo que realmente crece de lo que promedia. A esa diferencia se le llama arrastre de la volatilidad.',
    params: VOLATILITY_PARAMS,
    simulation:
      'Se invierten 100 en tres caminos que promedian exactamente el mismo rendimiento anual. Uno sube lo mismo cada ano. Los otros dos alternan un ano de promedio mas volatilidad y un ano de promedio menos volatilidad, uno con la volatilidad baja y otro con la alta. Sin azar: la unica diferencia entre los tres es cuanto oscilan.',
    questions: [
      'Si los tres promedian lo mismo, por que no terminan en el mismo lugar?',
      'Cuanto rendimiento anual te "cuesta" la volatilidad alta? Crece mas rapido que la volatilidad?',
      'Que significa esto al comparar dos fondos por su rendimiento promedio?',
    ],
    available: true,
    run: (input) => {
      const mu = read(input, VOLATILITY_PARAMS[0]) / 100
      const low = read(input, VOLATILITY_PARAMS[1]) / 100
      const high = read(input, VOLATILITY_PARAMS[2]) / 100
      // Always an even number of years, so every path has exactly as many up
      // years as down years and its average is exactly mu.
      const years = Math.max(2, 2 * Math.round(read(input, VOLATILITY_PARAMS[3]) / 2))

      const step = (value: number, sigma: number, year: number) =>
        value * (1 + mu + (year % 2 === 1 ? sigma : -sigma))

      const series: Array<Record<string, number>> = [
        { year: 0, noVolatility: 100, lowVolatility: 100, highVolatility: 100 },
      ]
      for (let year = 1; year <= years; year++) {
        const previous = series[year - 1]
        series.push({
          year,
          noVolatility: previous.noVolatility * (1 + mu),
          lowVolatility: step(previous.lowVolatility, low, year),
          highVolatility: step(previous.highVolatility, high, year),
        })
      }

      // Exact for an alternating path: each two-year pair multiplies by
      // (1+mu+sigma)(1+mu-sigma) = (1+mu)^2 - sigma^2.
      const compound = (sigma: number) => (Math.sqrt((1 + mu) ** 2 - sigma ** 2) - 1) * 100
      const last = series[series.length - 1]
      const dragHigh = mu * 100 - compound(high)

      return {
        series,
        chart: {
          kind: 'line',
          x: 'year',
          xLabel: 'Ano',
          xUnit: 'years',
          series: [
            { key: 'noVolatility', label: 'Sin volatilidad', unit: 'number' },
            { key: 'lowVolatility', label: `Volatilidad ${pct(low * 100, 0)}`, unit: 'number' },
            { key: 'highVolatility', label: `Volatilidad ${pct(high * 100, 0)}`, unit: 'number' },
          ],
        },
        highlights: [
          { label: 'Sin volatilidad, 100 terminan en', value: last.noVolatility.toFixed(1) },
          { label: `Con ${pct(low * 100, 0)} de volatilidad`, value: last.lowVolatility.toFixed(1) },
          { label: `Con ${pct(high * 100, 0)} de volatilidad`, value: last.highVolatility.toFixed(1) },
          { label: 'Lo que realmente crece con la alta', value: `${pct(compound(high), 2)} al ano` },
          { label: 'Arrastre de la volatilidad alta', value: `${dragHigh.toFixed(2)} puntos al ano` },
        ],
        interpretation:
          high <= 0 && low <= 0
            ? 'Sin ninguna volatilidad los tres caminos son el mismo. Sube cualquiera de las dos volatilidades y veras separarse las curvas aunque el promedio no cambie.'
            : `Los tres caminos promedian ${pct(mu * 100)} al ano, y aun asi despues de ${years} anos 100 se convierten en ${last.noVolatility.toFixed(1)}, ${last.lowVolatility.toFixed(1)} o ${last.highVolatility.toFixed(1)}. ` +
              `Con ${pct(high * 100, 0)} de volatilidad lo que de verdad crece es ${pct(compound(high), 2)} al ano, ${dragHigh.toFixed(2)} puntos menos que el promedio. ` +
              'El arrastre crece con el cuadrado de la volatilidad, no en proporcion: duplicarla cuadruplica aproximadamente el costo. Por eso un promedio alto con mucha oscilacion puede crecer menos que uno modesto y estable.',
      }
    },
  },

  {
    id: 'monteCarlo',
    title: 'Monte Carlo',
    objective: 'Ver que una proyeccion no es un numero, es un rango — y que tan ancho es ese rango.',
    concept:
      'Una calculadora de interes compuesto te da una cifra. Esa cifra es el escenario promedio, y la probabilidad de caer exactamente ahi es practicamente cero. Simular muchos caminos muestra el abanico completo.',
    params: MONTE_CARLO_PARAMS,
    simulation:
      'Se generan 600 caminos mensuales con choques aleatorios normales, con semilla fija, usando el mismo motor que el Asesor. Cada camino aplica el rendimiento esperado, un choque de la volatilidad indicada y la aportacion del mes. Se reportan los percentiles 10, 25, 50, 75 y 90 del valor final.',
    questions: [
      'Que tan lejos esta el P10 del P90? Te parece un rango aceptable?',
      'Si subes la volatilidad al doble, cuanto se ensancha el abanico?',
      'Cual es mas util para planear: la mediana o el P10?',
    ],
    available: true,
    run: (input) => {
      const capital = read(input, MONTE_CARLO_PARAMS[0])
      const monthly = read(input, MONTE_CARLO_PARAMS[1])
      const years = Math.round(read(input, MONTE_CARLO_PARAMS[2]))
      const expectedReturn = read(input, MONTE_CARLO_PARAMS[3]) / 100
      const volatility = read(input, MONTE_CARLO_PARAMS[4]) / 100

      // A fixed seed, so moving one slider changes the answer for that reason
      // and not because the dice were rolled again.
      const scenarios = buildScenarios({ months: years * 12, simulations: 600, seed: 4242 })
      const outcome = evaluarPlan(
        {
          capitalInicial: capital,
          aportacionMensual: monthly,
          años: years,
          rendimientoAnual: expectedReturn,
          volatilidadAnual: volatility,
        },
        null,
        scenarios,
      )

      const d = outcome.distribucion
      const spread = d.p50 > 0 ? ((d.p90 - d.p10) / d.p50) * 100 : 0
      const deterministic = outcome.proyeccionDeterminista

      return {
        series: [
          { percentile: 10, value: d.p10 },
          { percentile: 25, value: d.p25 },
          { percentile: 50, value: d.p50 },
          { percentile: 75, value: d.p75 },
          { percentile: 90, value: d.p90 },
        ],
        chart: {
          kind: 'bar',
          x: 'percentile',
          xLabel: 'Percentil',
          xUnit: 'number',
          xCategories: ['P10', 'P25', 'P50 (mediana)', 'P75', 'P90'],
          series: [{ key: 'value', label: 'Valor final', unit: 'money' }],
          referenceY: { value: deterministic.valorFinal, label: 'Calculadora de interes compuesto' },
        },
        highlights: [
          { label: 'Aportado en total', value: money(deterministic.capitalAportado) },
          { label: 'Escenario sin aleatoriedad', value: money(deterministic.valorFinal) },
          { label: 'Mediana simulada', value: money(d.p50) },
          { label: 'Rango P10 a P90', value: `${money(d.p10)} – ${money(d.p90)}` },
        ],
        interpretation:
          `La calculadora de interes compuesto te daria ${money(deterministic.valorFinal)}. La simulacion dice que el resultado esta entre ${money(d.p10)} y ${money(d.p90)} en 8 de cada 10 escenarios — un abanico de ${spread.toFixed(0)}% de la mediana. ` +
          'Planear con el numero unico es planear con el mejor caso de la mitad afortunada.',
      }
    },
  },

  {
    id: 'var',
    title: 'VaR y colas gordas',
    objective: 'Ver cuanto subestima el riesgo un modelo normal cuando los retornos no lo son.',
    concept:
      'La campana de Gauss dice que los movimientos extremos casi nunca pasan. Los mercados dicen otra cosa. Cuanto mas gordas las colas, mas se equivoca el modelo normal — y siempre se equivoca del lado optimista.',
    params: VAR_PARAMS,
    simulation:
      'Para cinco niveles de confianza se calcula el VaR de un dia con dos modelos: el normal, que solo usa la volatilidad, y el de Cornish-Fisher, que corrige el cuantil normal con la asimetria y la curtosis que elegiste. Son las mismas funciones que usa el analisis de riesgo de tu cartera.',
    questions: [
      'Con curtosis 0 y asimetria 0, por que coinciden los dos VaR?',
      'Que le pasa a la diferencia cuando subes la curtosis?',
      'Por que el CVaR siempre es mayor que el VaR?',
    ],
    available: true,
    run: (input) => {
      const dailyVol = read(input, VAR_PARAMS[0]) / 100
      const skew = read(input, VAR_PARAMS[1])
      const kurtosis = read(input, VAR_PARAMS[2])

      // Previously a second, inline copy of the Cornish-Fisher expansion. The
      // engine in var.ts is the one the portfolio risk tab uses and the one the
      // tests pin, so the lesson now shows exactly what the product computes.
      const series = [90, 95, 97.5, 99, 99.5].map((confidence) => ({
        confidence,
        normalVaR: (parametricVaR(0, dailyVol, confidence) ?? 0) * 100,
        adjustedVaR: (cornishFisherVaR(0, dailyVol, skew, kurtosis, confidence) ?? 0) * 100,
      }))

      const at99 = series.find((s) => s.confidence === 99)!
      const gap = at99.adjustedVaR - at99.normalVaR

      return {
        series,
        chart: {
          kind: 'line',
          x: 'confidence',
          xLabel: 'Nivel de confianza',
          xUnit: 'percent',
          series: [
            { key: 'normalVaR', label: 'VaR normal', unit: 'percent' },
            { key: 'adjustedVaR', label: 'VaR ajustado por forma', unit: 'percent' },
          ],
        },
        highlights: [
          { label: 'VaR normal al 99%', value: pct(at99.normalVaR, 2) },
          { label: 'VaR ajustado por forma', value: pct(at99.adjustedVaR, 2) },
          { label: 'Diferencia', value: `${signed(gap, 2)} puntos` },
        ],
        interpretation:
          gap > 0.05
            ? `Con asimetria ${skew.toFixed(1)} y curtosis ${kurtosis.toFixed(1)}, el modelo normal dice que el peor 1% de los dias pierde ${pct(at99.normalVaR, 2)}, pero la forma real de esa distribucion lo pone en ${pct(at99.adjustedVaR, 2)}. La campana subestima el riesgo en ${gap.toFixed(2)} puntos, y lo hace justo en la cola que importa.`
            : 'Con estos parametros la distribucion se parece bastante a una normal, asi que ambos modelos coinciden. Sube la curtosis para ver como se separan.',
      }
    },
  },

  {
    id: 'beta',
    title: 'Beta',
    objective: 'Ver que la beta amplifica en las dos direcciones, no solo en la que conviene.',
    concept:
      'La beta mide cuanto se mueve tu portafolio cuando se mueve el mercado. Una beta alta no es agresividad rentable: es el mismo multiplicador aplicado a las caidas.',
    params: BETA_PARAMS,
    simulation:
      'Se recorren movimientos del mercado de -40% a +40% y para cada uno se calcula el movimiento del portafolio como beta por movimiento del mercado. Es el modelo de un solo factor sin ruido: lo que la beta predice, no lo que un portafolio real haria exactamente.',
    questions: [
      'Con beta 1.5, cuanto pierdes si el mercado cae 20%?',
      'Que beta necesitas para perder la mitad que el mercado?',
      'Una beta negativa protege, pero que cuesta tenerla?',
    ],
    available: true,
    run: (input) => {
      const beta = read(input, BETA_PARAMS[0])
      const move = read(input, BETA_PARAMS[1])

      const series: Array<Record<string, number>> = []
      for (let market = -40; market <= 40; market += 5) {
        series.push({ market, portfolio: market * beta, marketItself: market })
      }

      const outcome = move * beta

      return {
        series,
        chart: {
          kind: 'line',
          x: 'market',
          xLabel: 'Movimiento del mercado',
          xUnit: 'percent',
          series: [
            { key: 'portfolio', label: 'Tu portafolio', unit: 'percent' },
            { key: 'marketItself', label: 'El mercado (beta 1)', unit: 'percent' },
          ],
          referenceY: { value: 0, label: 'Sin cambio' },
        },
        highlights: [
          { label: 'Movimiento del mercado', value: pct(move, 0) },
          { label: 'Tu portafolio', value: pct(outcome) },
          { label: 'Diferencia', value: `${(outcome - move).toFixed(1)} puntos` },
        ],
        interpretation:
          beta > 1
            ? `Con beta ${beta.toFixed(1)}, un mercado que se mueve ${pct(move, 0)} mueve tu portafolio ${pct(outcome)}. Cambia el signo del movimiento del mercado y veras que el mismo multiplicador trabaja en tu contra: la beta no distingue entre subidas y bajadas.`
            : beta < 0
              ? `Con beta ${beta.toFixed(1)} tu portafolio va en contra del mercado: sube cuando el cae. Eso protege en las caidas y cuesta en las subidas.`
              : `Con beta ${beta.toFixed(1)} tu portafolio amortigua al mercado: se mueve ${pct(outcome)} cuando el mercado se mueve ${pct(move, 0)}, en ambas direcciones.`,
      }
    },
  },

  {
    id: 'markowitz',
    title: 'Frontera eficiente (Markowitz)',
    objective: 'Ver que mezclas dominan a otras y cuales no vale la pena tener.',
    concept:
      'Para cada nivel de riesgo hay una mezcla que maximiza el rendimiento esperado. El conjunto de esas mezclas forma una curva, y todo lo que queda por debajo esta dominado.',
    params: MARKOWITZ_PARAMS,
    simulation:
      'Se recorren 41 mezclas de los dos activos, de 0% a 100% en A, y para cada una se calculan su volatilidad y su rendimiento esperado. El optimizador de la app encuentra ademas la mezcla de minima varianza exacta, y se compara con un 50/50.',
    questions: [
      'Por que ninguna mezcla puede estar por encima de la frontera?',
      'Que significa que un portafolio quede muy por debajo de ella?',
      'Baja la correlacion a -1: por que la curva se dobla tanto hacia la izquierda?',
    ],
    available: true,
    run: (input) => {
      const returnA = read(input, MARKOWITZ_PARAMS[0]) / 100
      const volA = read(input, MARKOWITZ_PARAMS[1]) / 100
      const returnB = read(input, MARKOWITZ_PARAMS[2]) / 100
      const volB = read(input, MARKOWITZ_PARAMS[3]) / 100
      const correlation = read(input, MARKOWITZ_PARAMS[4])

      const cov = covFromVolatilities([volA, volB], correlation)
      const chart: ChartSpec = {
        kind: 'line',
        x: 'volatility',
        xLabel: 'Volatilidad',
        xUnit: 'percent',
        series: [{ key: 'expectedReturn', label: 'Rendimiento esperado', unit: 'percent' }],
      }

      const frontier = efficientFrontier(['A', 'B'], cov, [returnA, returnB], {
        riskFreeRate: 0,
        // An equal split is the obvious thing someone would do without this
        // curve, so it is the useful thing to place against it.
        currentWeights: [0.5, 0.5],
      })

      if (!frontier) {
        return {
          series: [],
          chart,
          highlights: [{ label: 'Frontera', value: 'sin datos' }],
          interpretation:
            'Con estos parametros no hay una frontera que trazar: hace falta que al menos uno de los dos activos tenga volatilidad.',
        }
      }

      // Both halves of the curve. Everything below the minimum-variance point is
      // dominated — same risk, less return — and seeing it is the lesson.
      const series = Array.from({ length: 41 }, (_, i) => {
        const weightA = i / 40
        const stats = portfolioRiskReturn([weightA, 1 - weightA], cov, [returnA, returnB])
        return {
          weightA: weightA * 100,
          volatility: (stats?.volatility ?? 0) * 100,
          expectedReturn: (stats?.expectedReturn ?? 0) * 100,
        }
      })

      const minVar = frontier.minimumVariance
      const equal = frontier.current
      const lowestVolAsset = Math.min(volA, volB) * 100

      return {
        series,
        chart,
        highlights: [
          { label: 'Menor riesgo posible', value: pct(minVar.volatilityPct, 2) },
          { label: 'Rendimiento ahi', value: pct(minVar.expectedReturnPct, 2) },
          {
            label: 'Peso en A que lo logra',
            value: pct((minVar.weights[0]?.weight ?? 0) * 100, 0),
          },
          {
            label: 'Riesgo de un 50/50',
            value: equal ? pct(equal.volatilityPct, 2) : 'sin datos',
          },
        ],
        interpretation:
          minVar.volatilityPct < lowestVolAsset - 0.01
            ? `Con correlacion ${correlation.toFixed(1)}, la mezcla de menor riesgo corre ${pct(minVar.volatilityPct, 2)} de volatilidad: MENOS que el activo mas tranquilo de los dos por separado (${pct(lowestVolAsset, 2)}). Eso no es magia ni un error: cuando dos cosas no se mueven igual, una amortigua a la otra. Es el unico almuerzo gratis que existe en finanzas, y desaparece a medida que la correlacion sube a 1.`
            : `Con correlacion ${correlation.toFixed(1)} los dos activos se mueven casi igual, asi que mezclarlos ya no reduce el riesgo por debajo del activo mas tranquilo (${pct(lowestVolAsset, 2)}): la frontera se aplana hasta ser casi una linea recta entre los dos. Baja la correlacion y mira como se dobla hacia la izquierda — esa curvatura ES la diversificacion.`,
      }
    },
  },

  {
    id: 'riskParity',
    title: 'Risk Parity',
    objective: 'Ver que repartir el dinero en partes iguales no reparte el riesgo en partes iguales.',
    concept:
      'Si pones un tercio del dinero en acciones, bonos y materias primas, los activos volatiles aportan casi todo el riesgo y los bonos casi nada. Risk parity busca los pesos que hacen que cada activo aporte lo mismo al riesgo total: mas dinero en lo tranquilo, menos en lo volatil. El precio es que ese portafolio suele esperar menos rendimiento, y en la practica se le aplica apalancamiento para compensarlo, que trae riesgos propios (Asness, Frazzini y Pedersen, 2012, Financial Analysts Journal).',
    params: RISK_PARITY_PARAMS,
    simulation:
      'Se arma la matriz de covarianzas de los tres activos con sus volatilidades y la correlacion comun. Se calcula cuanto aporta cada uno al riesgo con pesos iguales, y luego se buscan los pesos de risk parity con el mismo motor de asignacion que usa tu cartera, y se vuelve a medir.',
    questions: [
      'Con pesos iguales, que porcentaje del riesgo viene de los bonos? Por que tan poco?',
      'Que le pasa al peso de los bonos en risk parity si bajas su volatilidad?',
      'Si risk parity tiene menos riesgo, por que no es simplemente mejor?',
    ],
    available: true,
    run: (input) => {
      const vols = [
        read(input, RISK_PARITY_PARAMS[0]) / 100,
        read(input, RISK_PARITY_PARAMS[1]) / 100,
        read(input, RISK_PARITY_PARAMS[2]) / 100,
      ]
      const correlation = read(input, RISK_PARITY_PARAMS[3])
      const names = ['Acciones', 'Bonos', 'Materias primas']
      const cov = covFromVolatilities(vols, correlation)

      const equalWeights = [1 / 3, 1 / 3, 1 / 3]
      const parityWeights = riskParityWeights(cov) ?? equalWeights

      // riskContributions sorts by contribution, so read it back by name.
      const shares = (weights: number[]) => {
        const attribution = riskContributions(names, weights, cov)
        return {
          volatility: (attribution?.portfolioVolatility ?? 0) * 100,
          share: (name: string) =>
            attribution?.contributions.find((c) => c.symbol === name)?.percentOfRisk ?? 0,
        }
      }
      const equal = shares(equalWeights)
      const parity = shares(parityWeights)

      const series = names.map((name, asset) => ({
        asset,
        equalMoney: equalWeights[asset] * 100,
        equalRisk: equal.share(name),
        parityMoney: parityWeights[asset] * 100,
        parityRisk: parity.share(name),
      }))

      const riskiest = series.reduce((a, b) => (a.equalRisk >= b.equalRisk ? a : b))
      const bonds = series[1]

      return {
        series,
        chart: {
          kind: 'bar',
          x: 'asset',
          xLabel: 'Activo',
          xUnit: 'number',
          xCategories: names,
          series: [
            { key: 'equalMoney', label: 'Dinero (partes iguales)', unit: 'percent' },
            { key: 'equalRisk', label: 'Riesgo (partes iguales)', unit: 'percent' },
            { key: 'parityMoney', label: 'Dinero (risk parity)', unit: 'percent' },
            { key: 'parityRisk', label: 'Riesgo (risk parity)', unit: 'percent' },
          ],
        },
        highlights: [
          {
            label: `Riesgo que aporta ${names[riskiest.asset].toLowerCase()} con partes iguales`,
            value: pct(riskiest.equalRisk),
          },
          { label: 'Riesgo que aportan los bonos con partes iguales', value: pct(bonds.equalRisk) },
          { label: 'Dinero en bonos con risk parity', value: pct(bonds.parityMoney) },
          { label: 'Volatilidad con partes iguales', value: pct(equal.volatility, 2) },
          { label: 'Volatilidad con risk parity', value: pct(parity.volatility, 2) },
        ],
        interpretation:
          `Con un tercio del dinero en cada uno, ${names[riskiest.asset].toLowerCase()} aportan ${pct(riskiest.equalRisk)} del riesgo y los bonos solo ${pct(bonds.equalRisk)}: repartir el dinero no reparte el riesgo. ` +
          `Para que cada uno aporte un tercio, risk parity pone ${pct(bonds.parityMoney)} del dinero en bonos, y la volatilidad baja de ${pct(equal.volatility, 2)} a ${pct(parity.volatility, 2)}. ` +
          'Ese portafolio mas tranquilo tambien espera menos rendimiento; no es una mejora gratis, es otra forma de decidir que riesgo quieres cargar.',
      }
    },
  },

  {
    id: 'stressTesting',
    title: 'Stress testing',
    objective:
      'Ver que el riesgo medido en tiempos tranquilos no es el riesgo de una crisis, porque en las crisis todo tiende a caer junto.',
    concept:
      'La diversificacion depende de que los activos no se muevan igual. Los estudios sobre mercados accionarios internacionales encuentran que las correlaciones suben en los mercados bajistas, justo cuando mas haria falta que no subieran (Longin y Solnik, 2001, Journal of Finance). Un stress test no promedia esa posibilidad: la supone y mide que pasa. Aqui los choques los eliges tu; el stress test con crisis historicas reales sobre tus propias posiciones esta en el analisis de tu cartera.',
    params: STRESS_PARAMS,
    simulation:
      'Para un portafolio con el mismo peso en cada activo, se calcula la volatilidad con correlaciones de 0 a 1, dos veces: con la volatilidad normal y con la volatilidad multiplicada por el factor de crisis. Luego se comparan tu escenario de calma y tu escenario de crisis, y el VaR de un dia al 99% de cada uno.',
    questions: [
      'Si solo sube la correlacion y no la volatilidad, cuanto aumenta el riesgo?',
      'Por que tener mas activos ayuda mucho en calma y poco en crisis?',
      'Un VaR calculado con datos de un ano tranquilo, que tan util es en marzo de 2020?',
    ],
    available: true,
    run: (input) => {
      const n = Math.round(read(input, STRESS_PARAMS[0]))
      const vol = read(input, STRESS_PARAMS[1]) / 100
      const calmCorrelation = read(input, STRESS_PARAMS[2])
      const crisisCorrelation = read(input, STRESS_PARAMS[3])
      const multiplier = read(input, STRESS_PARAMS[4])
      const weights = Array(n).fill(1 / n)

      const volatilityAt = (sigma: number, correlation: number) =>
        (portfolioVolatility(weights, uniformCov(n, sigma, correlation)) ?? 0) * 100

      const series: Array<Record<string, number>> = []
      for (let step = 0; step <= 20; step++) {
        const correlation = step / 20
        series.push({
          correlation,
          calmVolatility: volatilityAt(vol, correlation),
          crisisVolatility: volatilityAt(vol * multiplier, correlation),
        })
      }

      const calmVol = volatilityAt(vol, calmCorrelation)
      const crisisVol = volatilityAt(vol * multiplier, crisisCorrelation)
      const dailyVaR = (annualPct: number) =>
        (parametricVaR(0, annualPct / 100 / Math.sqrt(TRADING_DAYS), 99) ?? 0) * 100
      const ratio = calmVol > 0 ? crisisVol / calmVol : 1

      return {
        series,
        chart: {
          kind: 'line',
          x: 'correlation',
          xLabel: 'Correlacion entre los activos',
          xUnit: 'number',
          series: [
            { key: 'calmVolatility', label: 'Volatilidad normal', unit: 'percent' },
            { key: 'crisisVolatility', label: `Volatilidad x${multiplier}`, unit: 'percent' },
          ],
        },
        highlights: [
          { label: 'Riesgo del portafolio en calma', value: pct(calmVol, 2) },
          { label: 'Riesgo del portafolio en crisis', value: pct(crisisVol, 2) },
          { label: 'VaR de un dia al 99%, escenario tranquilo', value: pct(dailyVaR(calmVol), 2) },
          { label: 'VaR de un dia al 99%, escenario de choque', value: pct(dailyVaR(crisisVol), 2) },
          { label: 'Cuantas veces sube el riesgo', value: `${ratio.toFixed(2)}x` },
        ],
        interpretation:
          ratio <= 1.0001
            ? 'Tu escenario de crisis es identico al de calma, asi que el riesgo no cambia. Sube la correlacion de crisis o el multiplicador para ver lo que un stress test existe para mostrar.'
            : `Con ${n} activos, el portafolio corre ${pct(calmVol, 2)} de volatilidad en calma y ${pct(crisisVol, 2)} en tu escenario de crisis: ${ratio.toFixed(2)} veces mas. ` +
              `El VaR diario al 99% pasa de ${pct(dailyVaR(calmVol), 2)} a ${pct(dailyVaR(crisisVol), 2)}. ` +
              'Un modelo de riesgo calibrado en calma te habria dado la primera cifra el dia antes de necesitar la segunda. Fijate tambien en la curva: con correlacion alta, agregar activos casi no ayuda, porque ya no hay movimientos que se cancelen.',
      }
    },
  },

  {
    id: 'backtesting',
    title: 'Backtesting y suerte',
    objective:
      'Ver cuantas veces una regla le "gana" al mercado en precios que, por construccion, no se pueden predecir.',
    concept:
      'Un backtest ganador no prueba que una estrategia funcione. Si los precios son una caminata aleatoria, ninguna regla puede anticiparlos, y aun asi una parte de las pruebas sale ganadora por pura suerte. Si pruebas suficientes variantes y te quedas con la mejor, siempre encontraras una que parezca brillante en el pasado.',
    params: BACKTEST_PARAMS,
    simulation:
      'Se generan caminos de precios diarios aleatorios de dos anos, con la tendencia y la volatilidad que elegiste y una semilla fija por camino. En cada uno se corre un cruce de medias moviles con el mismo motor de backtesting de la app, incluyendo el costo por operacion, y se compara contra comprar y mantener.',
    questions: [
      'Los precios son aleatorios. Que significa entonces que la regla gane en algunos caminos?',
      'Si solo te mostraran el mejor camino, que concluirias sobre la estrategia?',
      'Que pasa con la cantidad de caminos ganadores cuando subes el costo por operacion?',
    ],
    available: true,
    run: (input) => {
      const paths = Math.round(read(input, BACKTEST_PARAMS[0]))
      const fast = Math.round(read(input, BACKTEST_PARAMS[1]))
      // A "fast" average at least as slow as the slow one is not a crossover.
      const slow = Math.max(Math.round(read(input, BACKTEST_PARAMS[2])), fast + 10)
      const drift = read(input, BACKTEST_PARAMS[3]) / 100
      const vol = read(input, BACKTEST_PARAMS[4]) / 100
      const costPct = read(input, BACKTEST_PARAMS[5])

      const sma = (period: number) => ({ kind: 'indicator' as const, indicator: 'sma' as const, period })
      const strategy: Strategy = {
        name: `Cruce de medias (${fast}/${slow})`,
        buy: {
          combinator: 'and',
          conditions: [{ left: sma(fast), operator: 'crossesAbove', right: sma(slow) }],
        },
        sell: {
          combinator: 'and',
          conditions: [{ left: sma(fast), operator: 'crossesBelow', right: sma(slow) }],
        },
      }

      const dt = 1 / TRADING_DAYS
      const base = Date.UTC(2000, 0, 3)
      const outcomes: Array<{ versus: number; strategy: number; buyAndHold: number; trades: number }> = []

      for (let path = 0; path < paths; path++) {
        const random = mulberry32(BACKTEST_SEED + path)
        const bars: Bar[] = []
        let close = 100
        for (let t = 0; t < BACKTEST_BARS; t++) {
          if (t > 0) {
            close *= Math.exp((drift - (vol * vol) / 2) * dt + vol * Math.sqrt(dt) * standardNormal(random))
          }
          bars.push({ date: new Date(base + t * 86_400_000).toISOString().slice(0, 10), close })
        }
        const run = runStrategy(strategy, bars, { costPct })
        if (!run) continue
        outcomes.push({
          versus: run.versusBuyAndHoldPp,
          strategy: run.backtest.strategy.totalReturnPct,
          buyAndHold: run.backtest.buyAndHold.totalReturnPct,
          trades: run.backtest.strategy.trades,
        })
      }

      outcomes.sort((a, b) => a.versus - b.versus)
      const series = outcomes.map((o, index) => ({
        path: index + 1,
        versusBuyAndHold: o.versus,
        strategyReturn: o.strategy,
        buyAndHoldReturn: o.buyAndHold,
      }))

      const wins = outcomes.filter((o) => o.versus > 0).length
      const best = outcomes.length ? outcomes[outcomes.length - 1].versus : 0
      const worst = outcomes.length ? outcomes[0].versus : 0
      const middle = median(outcomes.map((o) => o.versus))
      const trades = outcomes.length ? outcomes.reduce((s, o) => s + o.trades, 0) / outcomes.length : 0

      return {
        series,
        chart: {
          kind: 'bar',
          x: 'path',
          xLabel: 'Camino (ordenado de peor a mejor)',
          xUnit: 'number',
          series: [
            { key: 'versusBuyAndHold', label: 'Regla menos comprar y mantener', unit: 'pp' },
          ],
          referenceY: { value: 0, label: 'Empate con comprar y mantener' },
        },
        highlights: [
          { label: 'Caminos donde la regla gano', value: `${wins} de ${outcomes.length}` },
          { label: 'Mejor resultado', value: `${signed(best)} puntos` },
          { label: 'Peor resultado', value: `${signed(worst)} puntos` },
          { label: 'Resultado mediano', value: `${signed(middle)} puntos` },
          { label: 'Operaciones por camino', value: trades.toFixed(1) },
        ],
        interpretation:
          outcomes.length === 0
            ? 'No hubo historial suficiente para correr la regla con estas medias.'
            : `En ${wins} de ${outcomes.length} caminos la regla ${fast}/${slow} le gano a comprar y mantener, y el mejor le gano por ${best.toFixed(1)} puntos. ` +
              'Estos precios son aleatorios: no hay tendencia oculta que una media pueda detectar, asi que cada victoria es suerte. ' +
              (wins > 0
                ? `Si solo hubieras visto ese mejor camino, habrias creido que la regla funciona. Eso es lo que pasa cuando se prueban muchas reglas y se publica la ganadora.`
                : 'Aqui ni la suerte alcanzo: estar fuera del mercado y pagar costos pesa mas que cualquier acierto casual.'),
      }
    },
  },

  {
    id: 'rebalancing',
    title: 'Rebalanceo',
    objective: 'Ver que rebalancear es un intercambio, no una mejora gratuita.',
    concept:
      'Cuando el activo riesgoso sube, pasa a pesar mas de lo planeado y el portafolio se vuelve mas riesgoso de lo que decidiste. Rebalancear devuelve el riesgo a su sitio, y al hacerlo devuelve tambien parte del rendimiento esperado.',
    params: REBALANCING_PARAMS,
    simulation:
      'Se calcula la volatilidad de todas las mezclas de 0% a 100% en el activo riesgoso, con una correlacion fija de 0.2 entre ambos, y se marcan dos puntos: el peso que elegiste y el peso al que se desvio.',
    questions: [
      'Cuanto riesgo devuelve el rebalanceo, y cuanto rendimiento cuesta?',
      'Si el activo riesgoso siguiera subiendo, habria sido mejor no rebalancear?',
      'Por que entonces se rebalancea?',
    ],
    available: true,
    run: (input) => {
      const target = read(input, REBALANCING_PARAMS[0]) / 100
      const riskyVol = read(input, REBALANCING_PARAMS[1]) / 100
      const safeVol = read(input, REBALANCING_PARAMS[2]) / 100
      const drift = read(input, REBALANCING_PARAMS[3]) / 100

      const drifted = Math.min(0.99, Math.max(0.01, target + drift))
      const cov = covFromVolatilities([riskyVol, safeVol], 0.2)

      const series: Array<Record<string, number>> = []
      for (let w = 0; w <= 100; w += 5) {
        const sigma = portfolioVolatility([w / 100, 1 - w / 100], cov) ?? 0
        series.push({ riskyWeight: w, volatility: sigma * 100 })
      }

      const driftedVol = (portfolioVolatility([drifted, 1 - drifted], cov) ?? 0) * 100
      const targetVol = (portfolioVolatility([target, 1 - target], cov) ?? 0) * 100

      return {
        series,
        chart: {
          kind: 'line',
          x: 'riskyWeight',
          xLabel: 'Peso en el activo riesgoso',
          xUnit: 'percent',
          series: [{ key: 'volatility', label: 'Volatilidad del portafolio', unit: 'percent' }],
        },
        highlights: [
          { label: 'Peso objetivo', value: pct(target * 100, 0) },
          { label: 'Peso actual', value: pct(drifted * 100, 0) },
          { label: 'Riesgo actual', value: pct(driftedVol, 2) },
          { label: 'Riesgo tras rebalancear', value: pct(targetVol, 2) },
        ],
        interpretation:
          Math.abs(driftedVol - targetVol) < 0.01
            ? 'Con esta desviacion el riesgo practicamente no cambia, asi que rebalancear no aportaria gran cosa.'
            : `Al desviarse a ${pct(drifted * 100, 0)}, el portafolio corre ${pct(driftedVol, 2)} de volatilidad en lugar del ${pct(targetVol, 2)} que decidiste. Rebalancear devuelve ${Math.abs(driftedVol - targetVol).toFixed(2)} puntos de riesgo — y vende justamente lo que ha estado subiendo, que es la parte incomoda del intercambio.`,
      }
    },
  },

  {
    id: 'factors',
    title: 'Factores',
    objective:
      'Ver que una exposicion a factores es una estimacion, y que con poco historial un alfa aparente puede ser puro ruido.',
    concept:
      'Una regresion de factores separa el rendimiento en lo que explica el mercado, lo que explican otros factores como el tamano, y un resto llamado alfa. Pero cada coeficiente sale con un error estandar. Si el intervalo alrededor del alfa incluye el cero, no se puede distinguir de no tener ninguna habilidad, por grande que se vea el numero.',
    params: FACTOR_PARAMS,
    simulation:
      'Se simulan rendimientos diarios de dos factores sin premio (media cero) y de un activo construido con la beta, la exposicion a tamano y el alfa que elegiste, mas ruido propio. Luego se estima la regresion con el mismo motor que analiza tu cartera, usando cada vez mas historial, y se dibuja el alfa estimado con su banda de dos errores estandar.',
    questions: [
      'Con un ano de historial, que tan ancha es la banda del alfa? Incluye el cero?',
      'Pon el alfa real en 0. Cuanto historial hace falta para que la estimacion deje de "parecer" habilidad?',
      'Por que la beta se estima bien mucho antes que el alfa?',
    ],
    available: true,
    run: (input) => {
      const beta = read(input, FACTOR_PARAMS[0])
      const size = read(input, FACTOR_PARAMS[1])
      const alpha = read(input, FACTOR_PARAMS[2]) / 100
      const idio = read(input, FACTOR_PARAMS[3]) / 100
      const factorVol = read(input, FACTOR_PARAMS[4]) / 100
      const years = Math.round(read(input, FACTOR_PARAMS[5]))

      // Daily draws, because runFactorRegression annualises with 252. Feeding
      // it monthly returns would inflate the alpha twentyfold — the same
      // cadence trap that once reported the S&P 500 at 70% volatility.
      const n = years * TRADING_DAYS
      const random = mulberry32(FACTOR_SEED)
      const perDay = (annual: number) => annual / Math.sqrt(TRADING_DAYS)
      const market: number[] = []
      const smallMinusBig: number[] = []
      const asset: number[] = []
      for (let t = 0; t < n; t++) {
        const m = perDay(factorVol) * standardNormal(random)
        const s = perDay(factorVol) * standardNormal(random)
        const noise = perDay(idio) * standardNormal(random)
        market.push(m)
        smallMinusBig.push(s)
        asset.push(alpha / TRADING_DAYS + beta * m + size * s + noise)
      }

      const horizons = [...new Set([...FACTOR_HORIZONS.filter((h) => h < years), years])]
      const series: Array<Record<string, number>> = []
      let full: ReturnType<typeof runFactorRegression> = null
      for (const horizon of horizons) {
        const length = Math.round(horizon * TRADING_DAYS)
        const regression = runFactorRegression(asset.slice(0, length), [
          { name: 'Mercado', returns: market.slice(0, length) },
          { name: 'Tamano', returns: smallMinusBig.slice(0, length) },
        ])
        if (!regression) continue
        const band = 2 * regression.alphaStandardErrorAnnualPct
        series.push({
          years: horizon,
          alphaEstimate: regression.alphaAnnualPct,
          alphaUpper: regression.alphaAnnualPct + band,
          alphaLower: regression.alphaAnnualPct - band,
          trueAlpha: alpha * 100,
        })
        if (horizon === years) full = regression
      }

      const chart: ChartSpec = {
        kind: 'line',
        x: 'years',
        xLabel: 'Anos de historial usados',
        xUnit: 'years',
        series: [
          { key: 'alphaEstimate', label: 'Alfa estimado', unit: 'percent' },
          { key: 'alphaUpper', label: 'Limite superior (+2 errores)', unit: 'percent' },
          { key: 'alphaLower', label: 'Limite inferior (-2 errores)', unit: 'percent' },
          { key: 'trueAlpha', label: 'Alfa real', unit: 'percent' },
        ],
        referenceY: { value: 0, label: 'Sin habilidad' },
      }

      if (!full) {
        return {
          series,
          chart,
          highlights: [{ label: 'Regresion', value: 'sin datos' }],
          interpretation: 'No hubo suficientes observaciones para estimar la regresion.',
        }
      }

      const marketLoading = full.loadings.find((l) => l.factor === 'Mercado')!
      const sizeLoading = full.loadings.find((l) => l.factor === 'Tamano')!
      const band = 2 * full.alphaStandardErrorAnnualPct
      const lower = full.alphaAnnualPct - band
      const upper = full.alphaAnnualPct + band
      const includesZero = lower <= 0 && upper >= 0
      const shortest = series[0]

      return {
        series,
        chart,
        highlights: [
          {
            label: 'Beta de mercado estimada',
            value: `${marketLoading.coefficient.toFixed(2)} ± ${(2 * marketLoading.standardError).toFixed(2)}`,
          },
          {
            label: 'Exposicion a tamano estimada',
            value: `${sizeLoading.coefficient.toFixed(2)} ± ${(2 * sizeLoading.standardError).toFixed(2)}`,
          },
          { label: 'Alfa estimado', value: `${signed(full.alphaAnnualPct, 2)}% ± ${band.toFixed(2)}% al ano` },
          { label: 'Alfa real (el que elegiste)', value: `${signed(alpha * 100, 2)}%` },
          { label: 'El intervalo incluye el cero', value: includesZero ? 'Si' : 'No' },
        ],
        interpretation:
          `Con ${years} ${years === 1 ? 'ano' : 'anos'} de historial la beta sale en ${marketLoading.coefficient.toFixed(2)} (la real es ${beta.toFixed(2)}), bastante precisa. ` +
          `El alfa sale en ${signed(full.alphaAnnualPct, 2)}% al ano, pero su banda va de ${signed(lower, 2)}% a ${signed(upper, 2)}%` +
          (includesZero
            ? ', que incluye el cero: con estos datos no se puede distinguir de no tener ninguna habilidad. '
            : ', que no incluye el cero. ') +
          `Con solo ${shortest.years} ${shortest.years === 1 ? 'ano' : 'anos'} la banda media ${((shortest.alphaUpper - shortest.alphaLower) / 2).toFixed(1)} puntos a cada lado. ` +
          'La banda se estrecha con la raiz del tiempo: para partirla a la mitad hace falta cuatro veces mas historial. Por eso un fondo con tres buenos anos no ha demostrado nada todavia.',
      }
    },
  },

  {
    id: 'riskReturn',
    title: 'Riesgo contra rendimiento',
    objective: 'Ver que mas rendimiento esperado siempre viene acompanado de mas riesgo — y que la relacion no es recta.',
    concept:
      'Al mezclar un activo riesgoso con uno seguro obtienes una curva, no una recta. Esa curvatura es la diversificacion trabajando, y es la razon por la que algunas mezclas dominan a otras.',
    params: RISK_RETURN_PARAMS,
    simulation:
      'Se recorren las mezclas de 0% a 100% en el activo riesgoso en pasos de 5%, y para cada una se calcula la volatilidad y el rendimiento esperado. Se marca la mezcla de minima varianza.',
    questions: [
      'Existe alguna mezcla con menos riesgo que el activo seguro solo? Cuando?',
      'Que le pasa a la curva cuando la correlacion se acerca a 1?',
      'Si dos mezclas tienen el mismo riesgo, cual elegirias y por que?',
    ],
    available: true,
    run: (input) => {
      const riskyReturn = read(input, RISK_RETURN_PARAMS[0]) / 100
      const riskyVol = read(input, RISK_RETURN_PARAMS[1]) / 100
      const safeReturn = read(input, RISK_RETURN_PARAMS[2]) / 100
      const safeVol = read(input, RISK_RETURN_PARAMS[3]) / 100
      const correlation = read(input, RISK_RETURN_PARAMS[4])

      const cov = covFromVolatilities([riskyVol, safeVol], correlation)

      const series: Array<Record<string, number>> = []
      let minVol = Number.POSITIVE_INFINITY
      let minVolWeight = 0

      for (let w = 0; w <= 100; w += 5) {
        const sigma = portfolioVolatility([w / 100, 1 - w / 100], cov) ?? 0
        const ret = (w / 100) * riskyReturn + (1 - w / 100) * safeReturn
        series.push({ riskyWeight: w, volatility: sigma * 100, expectedReturn: ret * 100 })
        if (sigma < minVol) {
          minVol = sigma
          minVolWeight = w
        }
      }

      return {
        series,
        chart: {
          kind: 'line',
          x: 'volatility',
          xLabel: 'Volatilidad',
          xUnit: 'percent',
          series: [{ key: 'expectedReturn', label: 'Rendimiento esperado', unit: 'percent' }],
        },
        highlights: [
          { label: 'Mezcla de minima varianza', value: `${minVolWeight}% en el riesgoso` },
          { label: 'Riesgo en ese punto', value: pct(minVol * 100, 2) },
          { label: 'Solo activo seguro', value: pct(safeVol * 100, 2) },
        ],
        interpretation:
          minVolWeight > 0
            ? `La mezcla de minimo riesgo NO es 100% activo seguro: es ${minVolWeight}% en el riesgoso, con ${pct(minVol * 100, 2)} de volatilidad frente al ${pct(safeVol * 100, 2)} del seguro solo. Agregar un poco de riesgo bajo el riesgo total, porque los dos activos no se mueven igual.`
            : 'Con esta correlacion, la mezcla de minimo riesgo es quedarse en el activo seguro. Baja la correlacion hacia -1 y veras aparecer el efecto contrario.',
      }
    },
  },

  {
    id: 'drawdown',
    title: 'La asimetria de las perdidas',
    objective: 'Ver por que recuperar cuesta siempre mas que caer.',
    concept:
      'Una caida y su recuperacion no son simetricas, porque la subida trabaja sobre el saldo mas pequeno que dejo la caida. Es aritmetica, no psicologia, y es la razon por la que evitar las caidas grandes importa mas que capturar las subidas.',
    params: DRAWDOWN_PARAMS,
    simulation:
      'Para caidas de 5% a 95% se calcula la ganancia necesaria para volver al punto de partida, que es la caida dividida entre lo que queda despues de ella.',
    questions: [
      'Cuanto necesitas para recuperarte de una caida del 50%? Y del 90%?',
      'A partir de que caida la recuperacion necesaria se dispara?',
      'Que dice esto sobre el valor de limitar las perdidas?',
    ],
    available: true,
    run: (input) => {
      const target = read(input, DRAWDOWN_PARAMS[0])

      const series: Array<Record<string, number>> = []
      for (let fall = 5; fall <= 95; fall += 5) {
        series.push({ fall, recoveryNeeded: recoveryRequired(fall) ?? 0 })
      }

      const needed = recoveryRequired(target) ?? 0

      return {
        series,
        chart: {
          kind: 'line',
          x: 'fall',
          xLabel: 'Caida',
          xUnit: 'percent',
          series: [{ key: 'recoveryNeeded', label: 'Ganancia necesaria para recuperarse', unit: 'percent' }],
        },
        highlights: [
          { label: 'Caida', value: pct(target, 0) },
          { label: 'Ganancia necesaria', value: pct(needed) },
          { label: 'Cuantas veces la caida', value: `${(needed / target).toFixed(2)}x` },
        ],
        interpretation:
          `Una caida del ${pct(target, 0)} necesita una ganancia del ${pct(needed)} para volver al punto de partida: ${(needed / target).toFixed(2)} veces la caida. ` +
          'La curva no es recta — se dispara conforme la caida crece, porque cada punto perdido deja menos saldo sobre el que recuperar.',
      }
    },
  },
]

/** Flags that gate an experiment beyond its engine simply existing. */
const EXPERIMENT_FLAGS: Partial<Record<ExperimentId, FeatureFlag>> = {
  monteCarlo: 'monteCarlo',
  markowitz: 'markowitz',
  riskParity: 'riskParity',
  factors: 'factorModel',
  backtesting: 'backtesting',
}

export function listExperiments(): Experiment[] {
  // The lab as a whole sits behind financialLab; individual experiments behind
  // the engine they borrow.
  const labOn = isEnabled('financialLab')
  return EXPERIMENTS.map((experiment) => {
    const flag = labOn ? EXPERIMENT_FLAGS[experiment.id] : 'financialLab'
    if (!flag || !experiment.available) return experiment
    return isEnabled(flag)
      ? experiment
      : {
          ...experiment,
          available: false,
          unavailableReason: `Desactivado por configuracion (${flag}).`,
          run: undefined,
        }
  })
}

export function getExperiment(id: ExperimentId): Experiment | null {
  return listExperiments().find((e) => e.id === id) ?? null
}

/**
 * Run one experiment.
 *
 * Returns null for an experiment that is not available, rather than a plausible
 * result from a stub. An educational tool that fabricates a lesson is worse than
 * one that admits a gap.
 */
export function runExperiment(
  id: ExperimentId,
  params: Record<string, number> = {},
): ExperimentResult | null {
  const experiment = getExperiment(id)
  if (!experiment || !experiment.available || !experiment.run) return null
  return experiment.run(params)
}

/** Default parameter set for an experiment, so a page can render before any input. */
export function defaultParams(id: ExperimentId): Record<string, number> {
  const experiment = getExperiment(id)
  if (!experiment) return {}
  const params: Record<string, number> = {}
  for (const spec of experiment.params) params[spec.key] = spec.default
  return params
}
