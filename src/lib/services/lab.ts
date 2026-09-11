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

import { portfolioVolatility } from './risk-attribution'
import { parametricVaR } from './var'
import { recoveryRequired } from './drawdown'
import { buildScenarios, evaluarPlan } from './advisor'
import { efficientFrontier, portfolioRiskReturn } from './optimizer'
import { isEnabled, type FeatureFlag } from './feature-flags'

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
  | 'riskReturn'
  | 'monteCarlo'
  | 'var'
  | 'beta'
  | 'drawdown'
  | 'rebalancing'
  | 'markowitz'
  | 'stressTesting'

export type ExperimentResult = {
  /** Rows the interface can chart or tabulate directly. */
  series: Array<Record<string, number>>
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
  questions: string[]
  /** False when the engine behind it is not built yet. */
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

// ─── Experiments ────────────────────────────────────────────────────────────

const DIVERSIFICATION_PARAMS = [
  param('assets', 'Numero de activos', 1, 30, 1, 10),
  param('volatility', 'Volatilidad de cada activo', 5, 60, 1, 20, 'percent'),
  param('correlation', 'Correlacion entre ellos', -0.5, 1, 0.05, 0.2),
]

const CORRELATION_PARAMS = [
  param('volatilityA', 'Volatilidad del activo A', 5, 60, 1, 25, 'percent'),
  param('volatilityB', 'Volatilidad del activo B', 5, 60, 1, 15, 'percent'),
  param('weightA', 'Peso del activo A', 0, 100, 5, 50, 'percent'),
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

const REBALANCING_PARAMS = [
  param('riskyWeight', 'Peso objetivo del activo riesgoso', 10, 90, 5, 60, 'percent'),
  param('riskyVolatility', 'Volatilidad del activo riesgoso', 5, 60, 1, 25, 'percent'),
  param('safeVolatility', 'Volatilidad del activo seguro', 0, 20, 0.5, 4, 'percent'),
  param('drift', 'Cuanto se ha desviado el peso', -30, 30, 1, 15, 'percent'),
]

const EXPERIMENTS: Experiment[] = [
  {
    id: 'diversification',
    title: 'Diversificacion',
    objective: 'Ver cuanto riesgo desaparece al repartir, y donde deja de desaparecer.',
    concept:
      'El riesgo de un portafolio no es el promedio del riesgo de sus partes. Cuando los activos no se mueven exactamente igual, parte de sus movimientos se cancelan entre si. Lo que NO se cancela es el riesgo que comparten todos.',
    params: DIVERSIFICATION_PARAMS,
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
        highlights: [
          { label: 'Riesgo de un solo activo', value: `${(vol * 100).toFixed(1)}%` },
          { label: `Riesgo con ${maxAssets} activos`, value: `${last.portfolioVolatility.toFixed(1)}%` },
          { label: 'Piso teorico', value: `${floor.toFixed(1)}%` },
        ],
        interpretation:
          correlation >= 0.99
            ? 'Con correlacion 1 la curva es plana: agregar activos no reduce nada, porque todos se mueven a la vez. Diversificar no es tener muchas cosas, es tener cosas que no se muevan juntas.'
            : `Repartir entre ${maxAssets} activos baja el riesgo de ${(vol * 100).toFixed(1)}% a ${last.portfolioVolatility.toFixed(1)}%, pero la curva se aplana rapido. Por mas activos que agregues no bajaras de ${floor.toFixed(1)}%: ese piso es el riesgo que todos comparten y que ninguna diversificacion elimina.`,
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
      for (let rho = -1; rho <= 1.0001; rho += 0.1) {
        const correlation = Math.round(rho * 10) / 10
        const cov = [
          [volA * volA, volA * volB * correlation],
          [volA * volB * correlation, volB * volB],
        ]
        const sigma = portfolioVolatility(weights, cov)
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
        highlights: [
          { label: 'Riesgo con correlacion -1', value: `${atMinusOne.toFixed(2)}%` },
          { label: 'Riesgo con correlacion +1', value: `${atOne.toFixed(2)}%` },
          { label: 'Promedio ponderado', value: `${series[0].weightedAverage.toFixed(2)}%` },
        ],
        interpretation:
          `Con los mismos dos activos y los mismos pesos, el riesgo del portafolio va de ${atMinusOne.toFixed(2)}% a ${atOne.toFixed(2)}% dependiendo unicamente de la correlacion. ` +
          'En el extremo +1 el riesgo iguala al promedio ponderado: no hay ningun beneficio. Todo lo que ganas al diversificar sale de esa diferencia.',
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

      const cov = [
        [riskyVol * riskyVol, riskyVol * safeVol * correlation],
        [riskyVol * safeVol * correlation, safeVol * safeVol],
      ]

      const series: Array<Record<string, number>> = []
      let minVol = Number.POSITIVE_INFINITY
      let minVolWeight = 0

      for (let w = 0; w <= 100; w += 5) {
        const weights = [w / 100, 1 - w / 100]
        const sigma = portfolioVolatility(weights, cov) ?? 0
        const ret = (w / 100) * riskyReturn + (1 - w / 100) * safeReturn
        series.push({
          riskyWeight: w,
          volatility: sigma * 100,
          expectedReturn: ret * 100,
        })
        if (sigma < minVol) {
          minVol = sigma
          minVolWeight = w
        }
      }

      return {
        series,
        highlights: [
          { label: 'Mezcla de minima varianza', value: `${minVolWeight}% en el riesgoso` },
          { label: 'Riesgo en ese punto', value: `${(minVol * 100).toFixed(2)}%` },
          { label: 'Solo activo seguro', value: `${(safeVol * 100).toFixed(2)}%` },
        ],
        interpretation:
          minVolWeight > 0
            ? `La mezcla de minimo riesgo NO es 100% activo seguro: es ${minVolWeight}% en el riesgoso, con ${(minVol * 100).toFixed(2)}% de volatilidad frente al ${(safeVol * 100).toFixed(2)}% del seguro solo. Agregar un poco de riesgo bajo el riesgo total, porque los dos activos no se mueven igual.`
            : 'Con esta correlacion, la mezcla de minimo riesgo es quedarse en el activo seguro. Sube la correlacion hacia -1 y veras aparecer el efecto contrario.',
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

      return {
        series: [
          { percentile: 10, value: d.p10 },
          { percentile: 25, value: d.p25 },
          { percentile: 50, value: d.p50 },
          { percentile: 75, value: d.p75 },
          { percentile: 90, value: d.p90 },
        ],
        highlights: [
          { label: 'Aportado en total', value: outcome.proyeccionDeterminista.capitalAportado.toFixed(0) },
          { label: 'Escenario sin aleatoriedad', value: outcome.proyeccionDeterminista.valorFinal.toFixed(0) },
          { label: 'Mediana simulada', value: d.p50.toFixed(0) },
          { label: 'Rango P10 a P90', value: `${d.p10.toFixed(0)} - ${d.p90.toFixed(0)}` },
        ],
        interpretation:
          `La calculadora de interes compuesto te daria ${outcome.proyeccionDeterminista.valorFinal.toFixed(0)}. La simulacion dice que el resultado esta entre ${d.p10.toFixed(0)} y ${d.p90.toFixed(0)} en 8 de cada 10 escenarios — un abanico de ${spread.toFixed(0)}% de la mediana. ` +
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

      const series: Array<Record<string, number>> = []
      for (const confidence of [90, 95, 97.5, 99, 99.5]) {
        const normal = parametricVaR(0, dailyVol, confidence) ?? 0
        // Cornish-Fisher expanded with the shape the reader dialled in.
        const z = -((normal / dailyVol) || 0)
        const zcf =
          z +
          ((z * z - 1) * skew) / 6 +
          ((z * z * z - 3 * z) * kurtosis) / 24 -
          ((2 * z * z * z - 5 * z) * skew * skew) / 36
        series.push({
          confidence,
          normalVaR: normal * 100,
          adjustedVaR: Math.max(0, -zcf * dailyVol) * 100,
        })
      }

      const at99 = series.find((s) => s.confidence === 99)!
      const gap = at99.adjustedVaR - at99.normalVaR

      return {
        series,
        highlights: [
          { label: 'VaR normal al 99%', value: `${at99.normalVaR.toFixed(2)}%` },
          { label: 'VaR ajustado por forma', value: `${at99.adjustedVaR.toFixed(2)}%` },
          { label: 'Diferencia', value: `${gap >= 0 ? '+' : ''}${gap.toFixed(2)} puntos` },
        ],
        interpretation:
          gap > 0.05
            ? `Con asimetria ${skew.toFixed(1)} y curtosis ${kurtosis.toFixed(1)}, el modelo normal dice que el peor 1% de los dias pierde ${at99.normalVaR.toFixed(2)}%, pero la forma real de esa distribucion lo pone en ${at99.adjustedVaR.toFixed(2)}%. La campana subestima el riesgo en ${gap.toFixed(2)} puntos, y lo hace justo en la cola que importa.`
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
        series.push({ market, portfolio: market * beta })
      }

      const outcome = move * beta

      return {
        series,
        highlights: [
          { label: 'Movimiento del mercado', value: `${move.toFixed(0)}%` },
          { label: 'Tu portafolio', value: `${outcome.toFixed(1)}%` },
          { label: 'Diferencia', value: `${(outcome - move).toFixed(1)} puntos` },
        ],
        interpretation:
          beta > 1
            ? `Con beta ${beta.toFixed(1)}, un mercado que se mueve ${move.toFixed(0)}% mueve tu portafolio ${outcome.toFixed(1)}%. Cambia el signo del movimiento del mercado y veras que el mismo multiplicador trabaja en tu contra: la beta no distingue entre subidas y bajadas.`
            : beta < 0
              ? `Con beta ${beta.toFixed(1)} tu portafolio va en contra del mercado: sube cuando el cae. Eso protege en las caidas y cuesta en las subidas, que historicamente son mas frecuentes.`
              : `Con beta ${beta.toFixed(1)} tu portafolio amortigua al mercado: se mueve ${outcome.toFixed(1)}% cuando el mercado se mueve ${move.toFixed(0)}%, en ambas direcciones.`,
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
        highlights: [
          { label: 'Caida', value: `${target.toFixed(0)}%` },
          { label: 'Ganancia necesaria', value: `${needed.toFixed(1)}%` },
          { label: 'Cuantas veces la caida', value: `${(needed / target).toFixed(2)}x` },
        ],
        interpretation:
          `Una caida del ${target.toFixed(0)}% necesita una ganancia del ${needed.toFixed(1)}% para volver al punto de partida: ${(needed / target).toFixed(2)} veces la caida. ` +
          'La curva no es recta — se dispara conforme la caida crece, porque cada punto perdido deja menos saldo sobre el que recuperar.',
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
      const cov = [
        [riskyVol * riskyVol, riskyVol * safeVol * 0.2],
        [riskyVol * safeVol * 0.2, safeVol * safeVol],
      ]

      const series: Array<Record<string, number>> = []
      for (let w = 0; w <= 100; w += 5) {
        const sigma = portfolioVolatility([w / 100, 1 - w / 100], cov) ?? 0
        series.push({ riskyWeight: w, volatility: sigma * 100 })
      }

      const driftedVol = (portfolioVolatility([drifted, 1 - drifted], cov) ?? 0) * 100
      const targetVol = (portfolioVolatility([target, 1 - target], cov) ?? 0) * 100

      return {
        series,
        highlights: [
          { label: 'Peso objetivo', value: `${(target * 100).toFixed(0)}%` },
          { label: 'Peso actual', value: `${(drifted * 100).toFixed(0)}%` },
          { label: 'Riesgo actual', value: `${driftedVol.toFixed(2)}%` },
          { label: 'Riesgo tras rebalancear', value: `${targetVol.toFixed(2)}%` },
        ],
        interpretation:
          Math.abs(driftedVol - targetVol) < 0.01
            ? 'Con esta desviacion el riesgo practicamente no cambia, asi que rebalancear no aportaria gran cosa.'
            : `Al desviarse a ${(drifted * 100).toFixed(0)}%, el portafolio corre ${driftedVol.toFixed(2)}% de volatilidad en lugar del ${targetVol.toFixed(2)}% que decidiste. Rebalancear devuelve ${Math.abs(driftedVol - targetVol).toFixed(2)} puntos de riesgo — y vende justamente lo que ha estado subiendo, que es la parte incomoda del intercambio.`,
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

      const cov = [
        [volA * volA, volA * volB * correlation],
        [volA * volB * correlation, volB * volB],
      ]

      const frontier = efficientFrontier(['A', 'B'], cov, [returnA, returnB], {
        riskFreeRate: 0,
        // An equal split is the obvious thing someone would do without this
        // curve, so it is the useful thing to place against it.
        currentWeights: [0.5, 0.5],
      })

      if (!frontier) {
        return {
          series: [],
          highlights: [],
          interpretation:
            'Con estos parametros no hay una frontera que trazar: hace falta que al menos uno de los dos activos tenga volatilidad.',
        }
      }

      // Both halves of the curve. Everything below the minimum-variance point is
      // dominated — same risk, less return — and seeing it is the lesson.
      const series = Array.from({ length: 41 }, (_, i) => {
        const weightA = i / 40
        const weights = [weightA, 1 - weightA]
        const stats = portfolioRiskReturn(weights, cov, [returnA, returnB])
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
        highlights: [
          { label: 'Menor riesgo posible', value: `${minVar.volatilityPct.toFixed(2)}%` },
          { label: 'Rendimiento ahi', value: `${minVar.expectedReturnPct.toFixed(2)}%` },
          {
            label: 'Peso en A que lo logra',
            value: `${((minVar.weights[0]?.weight ?? 0) * 100).toFixed(0)}%`,
          },
          {
            label: 'Riesgo de un 50/50',
            value: equal ? `${equal.volatilityPct.toFixed(2)}%` : 'n/d',
          },
        ],
        interpretation:
          minVar.volatilityPct < lowestVolAsset - 0.01
            ? `Con correlacion ${correlation.toFixed(1)}, la mezcla de menor riesgo corre ${minVar.volatilityPct.toFixed(2)}% de volatilidad: MENOS que el activo mas tranquilo de los dos por separado (${lowestVolAsset.toFixed(2)}%). Eso no es magia ni un error: cuando dos cosas no se mueven igual, una amortigua a la otra, y mezclarlas produce un riesgo menor que cualquiera de las dos. Es el unico almuerzo gratis que existe en finanzas, y desaparece a medida que la correlacion sube a 1.`
            : `Con correlacion ${correlation.toFixed(1)} los dos activos se mueven casi igual, asi que mezclarlos ya no reduce el riesgo por debajo del activo mas tranquilo (${lowestVolAsset.toFixed(2)}%): la frontera se aplana hasta ser casi una linea recta entre los dos. Baja la correlacion y mira como se dobla hacia la izquierda — esa curvatura ES la diversificacion.`,
      }
    },
  },

  {
    id: 'stressTesting',
    title: 'Stress testing historico',
    objective: 'Ver que le habria pasado a tu portafolio en crisis que si ocurrieron.',
    concept:
      'Una simulacion asume una distribucion. Una crisis real no pide permiso a ninguna distribucion. Revisar 2008 o marzo de 2020 dice algo que ningun Monte Carlo dice.',
    params: [],
    questions: [
      'Cuanto habria caido tu portafolio en 2008?',
      'Cuanto tiempo habria tardado en recuperarse?',
    ],
    available: false,
    unavailableReason:
      'El motor de stress testing historico ya existe (tarea P1-30), pero no vive aqui: necesita el historial de precios real de TUS posiciones, no parametros sinteticos como el resto del laboratorio. Esta en el analisis de tu cartera, en GET /api/analytics/[pid]/stress. Aqui seguiria sin poder medir nada, y el roadmap prohibe inventar drawdowns.',
  },
]

/** Flags that gate an experiment beyond its engine simply existing. */
const EXPERIMENT_FLAGS: Partial<Record<ExperimentId, FeatureFlag>> = {
  monteCarlo: 'monteCarlo',
  markowitz: 'markowitz',
  stressTesting: 'financialLab',
}

export function listExperiments(): Experiment[] {
  return EXPERIMENTS.map((experiment) => {
    const flag = EXPERIMENT_FLAGS[experiment.id]
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
