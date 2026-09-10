// Metric explanations — pure functions, no I/O.
//
// A dashboard full of numbers teaches nothing on its own. "Sharpe 0.82" is only
// information to someone who already knows what a Sharpe ratio is, and for
// everyone else it is decoration that looks authoritative.
//
// So every explanation here has three parts: the formula, a definition of what
// the quantity means, and — the part that matters — a reading of THE READER'S
// OWN NUMBER. A generic definition is the thing this module exists to replace.

import { recoveryRequired } from './drawdown'

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
}

export type MetricExplanation = {
  id: MetricId
  name: string
  formula: string
  definition: string
  /** The reader's own value, read back to them. Never generic. */
  interpretation: string
}

const NO_VALUE = 'Todavia no hay datos suficientes para calcular esta metrica.'

function fmt(value: number, decimals = 2): string {
  return value.toFixed(decimals)
}

function money(value: number, currency = ''): string {
  const formatted = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.abs(value))
  return `${formatted}${currency ? ' ' + currency : ''}`
}

type Definition = {
  name: string
  formula: string
  definition: string
  read: (value: number, ctx: MetricContext) => string
}

const DEFINITIONS: Record<MetricId, Definition> = {
  return: {
    name: 'Rendimiento',
    formula: '(Valor final - Valor inicial) / Valor inicial',
    definition:
      'Cuanto crecio o cayo el valor de la inversion en el periodo, expresado como porcentaje de lo que valia al principio.',
    read: (v) =>
      v >= 0
        ? `Tu ${fmt(v)}% significa que cada 100 invertidos se convirtieron en ${fmt(100 + v)}.`
        : `Tu ${fmt(v)}% significa que cada 100 invertidos quedaron en ${fmt(100 + v)}.`,
  },

  volatility: {
    name: 'Volatilidad',
    formula: 'sigma = desviacion estandar de los retornos diarios x raiz(252)',
    definition:
      'Que tanto se mueve el valor de la inversion, hacia arriba y hacia abajo. No mide perdidas: mide inestabilidad, y una subida brusca cuenta igual que una caida.',
    read: (v) =>
      `Con ${fmt(v)}% anual, en aproximadamente 2 de cada 3 anios el resultado deberia caer dentro de mas o menos ${fmt(v)} puntos del promedio. Un anio de cada 20 se saldra del doble de ese rango.`,
  },

  sharpe: {
    name: 'Sharpe',
    formula: 'Sharpe = (Rp - Rf) / sigma',
    definition:
      'Cuanto rendimiento obtienes por cada unidad de riesgo que corres, despues de descontar lo que habrias ganado sin riesgo alguno.',
    read: (v, ctx) => {
      const rf = ctx.riskFreeRatePct !== undefined ? ` (tasa libre de riesgo: ${fmt(ctx.riskFreeRatePct)}%)` : ''
      if (v < 0) {
        return `Tu ${fmt(v)} es negativo${rf}: el portafolio rindio menos que la tasa libre de riesgo, asi que el riesgo que corriste no se pago.`
      }
      if (v < 0.5) {
        return `Tu ${fmt(v)} es bajo${rf}: ganas poco por cada unidad de riesgo que aceptas.`
      }
      if (v < 1) {
        return `Tu ${fmt(v)} es razonable${rf}: el rendimiento compensa el riesgo, sin destacar.`
      }
      return `Tu ${fmt(v)} es alto${rf}: estas obteniendo bastante rendimiento por cada unidad de riesgo. Revisa que el periodo medido no sea demasiado corto para sostener esa lectura.`
    },
  },

  sortino: {
    name: 'Sortino',
    formula: 'Sortino = (Rp - Rf) / sigma_bajista',
    definition:
      'Como el Sharpe, pero solo castiga los movimientos hacia abajo. Parte de la idea de que la volatilidad al alza no es un problema que haga falta penalizar.',
    read: (v) =>
      v < 0
        ? `Tu ${fmt(v)} negativo indica que el portafolio no supero la tasa libre de riesgo pese a considerar solo las caidas.`
        : `Tu ${fmt(v)} mide el rendimiento por unidad de riesgo a la baja. Si es notablemente mayor que tu Sharpe, tus movimientos bruscos han sido mas al alza que a la baja.`,
  },

  beta: {
    name: 'Beta',
    formula: 'Beta = Cov(Rp, Rb) / Var(Rb)',
    definition:
      'Cuanto se mueve tu portafolio cuando se mueve el mercado. Es sensibilidad, no calidad: una beta alta no es mejor ni peor, es mas movimiento.',
    read: (v, ctx) => {
      const bench = ctx.benchmarkName ?? 'el benchmark'
      if (v > 1.1) {
        return `Tu ${fmt(v)} amplifica ${bench}: cuando sube 1%, tu portafolio ha subido cerca de ${fmt(v)}% — y cuando baja, tambien baja mas.`
      }
      if (v < 0.9) {
        return `Tu ${fmt(v)} amortigua ${bench}: te mueves menos que el mercado en ambas direcciones.`
      }
      return `Tu ${fmt(v)} sigue de cerca a ${bench}: te mueves practicamente con el mercado.`
    },
  },

  alpha: {
    name: 'Alpha',
    formula: 'Alpha = Rp - [Rf + beta x (Rm - Rf)]',
    definition:
      'El rendimiento que queda despues de descontar lo que la beta ya explicaba. Un portafolio con beta 1.5 en un mercado al alza gana mucho sin tener nada de alpha: ese rendimiento lo produjo el riesgo de mercado, no la seleccion.',
    read: (v, ctx) => {
      const bench = ctx.benchmarkName ?? 'el benchmark'
      return v >= 0
        ? `Tu ${fmt(v)} puntos anuales es lo que tu portafolio agrego por encima de lo que su beta frente a ${bench} ya justificaba.`
        : `Tu ${fmt(v)} puntos anuales indica que el portafolio rindio menos de lo que su beta frente a ${bench} hacia esperar.`
    },
  },

  var: {
    name: 'VaR (Valor en Riesgo)',
    formula: 'VaR_95 = percentil 5 de la distribucion de retornos',
    definition:
      'La perdida que no deberias superar en 95 de cada 100 dias. Es un umbral, no un techo: no dice nada sobre que tan mal puede ir el 5% restante.',
    read: (v, ctx) => {
      if (ctx.portfolioValue && ctx.portfolioValue > 0) {
        const amount = (ctx.portfolioValue * v) / 100
        return `Tu ${fmt(v)}% equivale a unos ${money(amount, ctx.currency)} sobre el valor actual del portafolio. En 1 de cada 20 dias la perdida deberia superar esa cifra.`
      }
      return `Tu ${fmt(v)}% es la perdida diaria que no deberias superar en 19 de cada 20 dias. Mira tambien el CVaR: este numero no dice que tan mal va el dia 20.`
    },
  },

  cvar: {
    name: 'CVaR (Perdida esperada)',
    formula: 'CVaR_95 = promedio de los retornos peores que el VaR_95',
    definition:
      'El promedio de las perdidas en los dias que si superan el VaR. Si el VaR dice a que distancia esta el borde del acantilado, el CVaR dice que tan hondo es la caida.',
    read: (v, ctx) => {
      if (ctx.portfolioValue && ctx.portfolioValue > 0) {
        const amount = (ctx.portfolioValue * v) / 100
        return `Tu ${fmt(v)}% equivale a unos ${money(amount, ctx.currency)}: es lo que en promedio pierdes los dias malos de verdad, y es la cifra con la que conviene planear.`
      }
      return `Tu ${fmt(v)}% es la perdida promedio en los peores dias. Siempre es igual o mayor que el VaR, por definicion.`
    },
  },

  maxDrawdown: {
    name: 'Maximo drawdown',
    formula: 'max((Pico - Valle) / Pico)',
    definition:
      'La peor caida desde un maximo hasta el fondo siguiente. Mide lo que un inversionista habria tenido que aguantar sin vender.',
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
    formula: 'TE = desviacion estandar(Rp - Rb) x raiz(252)',
    definition:
      'Que tanto se separa tu portafolio del benchmark en un anio tipico. No es un error que estes cometiendo: un tracking error bajo solo significa que te pareces al indice.',
    read: (v, ctx) => {
      const bench = ctx.benchmarkName ?? 'el benchmark'
      if (v < 2) return `Tu ${fmt(v)}% es bajo: tu portafolio se comporta muy parecido a ${bench}.`
      if (v < 8) return `Tu ${fmt(v)}% es moderado: te separas de ${bench} de forma apreciable pero no radical.`
      return `Tu ${fmt(v)}% es alto: tu portafolio se comporta bastante distinto de ${bench}, para bien o para mal.`
    },
  },

  informationRatio: {
    name: 'Information ratio',
    formula: 'IR = Alpha / Tracking error',
    definition:
      'Si el tracking error mide cuanto te alejas del indice, el information ratio responde si alejarte valio la pena.',
    read: (v) =>
      v > 0.5
        ? `Tu ${fmt(v)} es bueno: separarte del indice te pago bien por el riesgo adicional que eso implico.`
        : v > 0
          ? `Tu ${fmt(v)} es positivo pero modesto: separarte del indice te pago, poco.`
          : `Tu ${fmt(v)} es negativo: separarte del indice te costo dinero — seguirlo habria salido mejor.`,
  },

  hhi: {
    name: 'HHI (concentracion)',
    formula: 'HHI = suma de los pesos al cuadrado',
    definition:
      'Que tan concentrado esta el portafolio por peso. Vale 1 si todo esta en una sola posicion y 1/N si esta repartido en partes iguales entre N.',
    read: (v) => {
      const equivalent = v > 0 ? 1 / v : 0
      if (v > 0.5) {
        return `Tu ${fmt(v, 3)} indica que estas muy concentrado: equivale a tener todo repartido entre apenas ${fmt(equivalent, 1)} posiciones iguales.`
      }
      if (v > 0.25) {
        return `Tu ${fmt(v, 3)} indica concentracion moderada: equivale a unas ${fmt(equivalent, 1)} posiciones iguales.`
      }
      return `Tu ${fmt(v, 3)} indica buen reparto por peso: equivale a unas ${fmt(equivalent, 1)} posiciones iguales.`
    },
  },

  effectiveBets: {
    name: 'Apuestas independientes efectivas',
    formula: 'N_eff a partir de la concentracion de la varianza explicada',
    definition:
      'Cuantas fuentes de riesgo realmente distintas tienes. Diez posiciones que se mueven juntas son una sola apuesta repetida diez veces, y el HHI no lo detecta porque solo mira pesos.',
    read: (v) =>
      v < 2
        ? `Tu ${fmt(v, 1)} significa que, en la practica, casi todo tu riesgo viene de una sola fuente aunque tengas varias posiciones.`
        : `Tu ${fmt(v, 1)} es el numero aproximado de apuestas realmente independientes que tienes. Comparalo con cuantas posiciones tienes: si la diferencia es grande, tus activos se mueven juntos.`,
  },

  xirr: {
    name: 'XIRR / rendimiento del inversionista',
    formula: 'La tasa r que hace que la suma de flujos / (1+r)^t sea cero',
    definition:
      'Tu rendimiento real considerando cuando y cuanto aportaste. Si metiste mas dinero justo antes de una buena racha, este numero lo recoge; el momento de cada aportacion importa aqui.',
    read: (v) =>
      `Tu ${fmt(v)}% anual es lo que efectivamente rindio TU dinero, dado el momento en que lo pusiste. Comparalo con el TWR: si son distintos, la diferencia es el efecto del timing de tus aportaciones.`,
  },

  twr: {
    name: 'TWR / rendimiento de la estrategia',
    formula: 'TWR = producto de (1 + Ri) de cada subperiodo - 1',
    definition:
      'El rendimiento de la estrategia aislando el efecto de tus aportaciones y retiros. Es el numero comparable contra un indice, porque un indice tampoco recibe flujos.',
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
    formula: definition.formula,
    definition: definition.definition,
    interpretation: usable ? definition.read(value as number, context) : NO_VALUE,
  }
}

/** Every metric explained at once, for a page that wants the whole glossary. */
export function explainAll(
  values: Partial<Record<MetricId, number | null>>,
  context: MetricContext = {},
): MetricExplanation[] {
  return METRIC_IDS.map((id) => explainMetric(id, values[id] ?? null, context)!).filter(Boolean)
}
