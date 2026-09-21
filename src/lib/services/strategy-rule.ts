// Strategy rules — pure functions, no I/O.
//
// A strategy here is DATA, not code: a pair of rules (when to buy, when to sell)
// built from indicators, operators and constants. `compileStrategy` turns that
// data into the exact `SignalFn` the backtester already accepts, which is what
// makes the sandbox honest — a strategy the user builds by clicking runs through
// the same engine, with the same look-ahead guard, as one written in TypeScript.
//
// That guard is the whole reason this file is shaped this way. `SignalFn`
// receives the closes up to and including the decision bar and nothing else, so
// a rule physically cannot see the future. Every indicator below is computed
// from that slice, never from a wider series handed in from outside.
//
// ── What this is not ────────────────────────────────────────────────────────
//
// It is not a recommendation engine. docs/BACKTEST_RESULTS.md records that the
// app's own technical signal loses to buy-and-hold on 9 of 10 real assets over
// five years, median -75 percentage points. The point of letting someone build
// a strategy and backtest it is to let them find that out for themselves on
// their own rules, which is a far better lesson than being told.

import {
  calculateSMA,
  calculateEMA,
  calculateRSI,
  calculateBollingerBands,
} from '@/lib/utils/indicators'
import type { SignalFn, SignalAction } from './backtest'

export type IndicatorId =
  | 'price'
  | 'sma'
  | 'ema'
  | 'rsi'
  | 'bollingerUpper'
  | 'bollingerMiddle'
  | 'bollingerLower'

export type IndicatorSpec = {
  id: IndicatorId
  label: string
  /** False for price, which has no period to choose. */
  hasPeriod: boolean
  defaultPeriod: number
  explanation: string
}

export const INDICATOR_SPECS: IndicatorSpec[] = [
  {
    id: 'price',
    label: 'Precio',
    hasPeriod: false,
    defaultPeriod: 0,
    explanation:
      'El cierre del día. Es la referencia contra la que se comparan casi todos los demás indicadores.',
  },
  {
    id: 'sma',
    label: 'Media móvil simple (SMA)',
    hasPeriod: true,
    defaultPeriod: 20,
    explanation:
      'El promedio de los últimos N cierres, todos con el mismo peso. Suaviza el ruido diario para dejar ver la dirección de fondo.',
  },
  {
    id: 'ema',
    label: 'Media móvil exponencial (EMA)',
    hasPeriod: true,
    defaultPeriod: 20,
    explanation:
      'Como la SMA pero dando más peso a los días recientes, así que reacciona antes a un cambio de tendencia y también se equivoca antes.',
  },
  {
    id: 'rsi',
    label: 'RSI',
    hasPeriod: true,
    defaultPeriod: 14,
    explanation:
      'Mide la fuerza de las subidas frente a las bajadas en una escala de 0 a 100. Por encima de 70 se suele llamar sobrecompra y por debajo de 30 sobreventa, pero un activo en tendencia puede quedarse en 80 durante meses.',
  },
  {
    id: 'bollingerUpper',
    label: 'Banda de Bollinger superior',
    hasPeriod: true,
    defaultPeriod: 20,
    explanation:
      'La media móvil más dos desviaciones estándar. El precio la toca cuando se mueve mucho más de lo normal hacia arriba.',
  },
  {
    id: 'bollingerMiddle',
    label: 'Banda de Bollinger central',
    hasPeriod: true,
    defaultPeriod: 20,
    explanation:
      'La media móvil sobre la que se construyen las bandas. Sirve como objetivo cuando el precio vuelve a su nivel habitual.',
  },
  {
    id: 'bollingerLower',
    label: 'Banda de Bollinger inferior',
    hasPeriod: true,
    defaultPeriod: 20,
    explanation:
      'La media móvil menos dos desviaciones estándar. El precio la toca cuando cae mucho más de lo normal.',
  },
]

export type OperatorId = 'gt' | 'lt' | 'crossesAbove' | 'crossesBelow'

export type OperatorSpec = {
  id: OperatorId
  label: string
  /** True when the operator needs the previous bar as well as this one. */
  needsPrevious: boolean
  explanation: string
}

export const OPERATORS: OperatorSpec[] = [
  {
    id: 'gt',
    label: 'es mayor que',
    needsPrevious: false,
    explanation: 'Se cumple mientras la condición sea cierta, día tras día.',
  },
  {
    id: 'lt',
    label: 'es menor que',
    needsPrevious: false,
    explanation: 'Se cumple mientras la condición sea cierta, día tras día.',
  },
  {
    id: 'crossesAbove',
    label: 'cruza por encima de',
    needsPrevious: true,
    explanation:
      'Se cumple SOLO el día del cruce: ayer estaba por debajo y hoy está por encima. Dispara una vez, no todos los días que siga arriba.',
  },
  {
    id: 'crossesBelow',
    label: 'cruza por debajo de',
    needsPrevious: true,
    explanation:
      'Se cumple SOLO el día del cruce: ayer estaba por encima y hoy está por debajo.',
  },
]

export type Operand =
  | { kind: 'indicator'; indicator: IndicatorId; period?: number }
  | { kind: 'constant'; value: number }

export type Condition = {
  left: Operand
  operator: OperatorId
  right: Operand
}

export type Combinator = 'and' | 'or'

export type Rule = {
  combinator: Combinator
  conditions: Condition[]
}

export type Strategy = {
  name: string
  buy: Rule
  sell: Rule
}

/** Below this a period is not a window, it is a typo. */
const MIN_PERIOD = 2
const MAX_PERIOD = 400

function periodFor(operand: Extract<Operand, { kind: 'indicator' }>): number {
  const spec = INDICATOR_SPECS.find((s) => s.id === operand.indicator)
  if (!spec || !spec.hasPeriod) return 0
  return operand.period ?? spec.defaultPeriod
}

/**
 * The value of one operand, `lookback` bars before the end of the series.
 *
 * `lookback` exists for the cross operators, which need yesterday as well as
 * today. It slices the series rather than indexing into a precomputed array so
 * that "yesterday's value" is computed from yesterday's data — indexing would
 * give the value an indicator had after seeing bars it had not seen yet.
 *
 * Returns null, never a partial number, when the window has not filled.
 */
export function evaluateOperand(
  operand: Operand,
  closes: number[],
  lookback = 0,
): number | null {
  if (operand.kind === 'constant') {
    return Number.isFinite(operand.value) ? operand.value : null
  }

  const end = closes.length - Math.max(0, lookback)
  if (end <= 0) return null
  for (let i = 0; i < end; i++) {
    if (!Number.isFinite(closes[i])) return null
  }

  const last = <T,>(values: T[]): T | null => (values.length > 0 ? values[values.length - 1] : null)
  const period = periodFor(operand)

  // The whole history up to the decision bar, for indicators whose last value
  // depends on all of it (EMA and RSI are recursive).
  const history = () => (end === closes.length ? closes : closes.slice(0, end))
  // Only the last `period` bars, for indicators whose last value depends on
  // nothing else. calculateSMA sums exactly this slice, in this order, for its
  // final value, so the result is bit-identical to passing the full history —
  // it just stops recomputing every earlier bar's average to throw it away.
  // That recomputation, eight times a bar, made a two-year backtest cost
  // seconds. The tests pin the equality for every indicator.
  const window = () => closes.slice(Math.max(0, end - period), end)

  switch (operand.indicator) {
    case 'price':
      return closes[end - 1]

    case 'sma':
      return last(calculateSMA(window(), period))
    case 'ema':
      return last(calculateEMA(history(), period))
    case 'rsi':
      return last(calculateRSI(history(), period))

    case 'bollingerUpper':
      return last(calculateBollingerBands(window(), period).upper)
    case 'bollingerMiddle':
      return last(calculateBollingerBands(window(), period).middle)
    case 'bollingerLower':
      return last(calculateBollingerBands(window(), period).lower)

    default:
      return null
  }
}

/**
 * Whether one condition holds on the last bar of `closes`.
 *
 * False — never true — when either side cannot be computed. A strategy that
 * trades on missing data is worse than one that does nothing, and an unknown
 * dressed as a signal is exactly how a backtest becomes fiction.
 */
export function evaluateCondition(condition: Condition, closes: number[]): boolean {
  const left = evaluateOperand(condition.left, closes)
  const right = evaluateOperand(condition.right, closes)
  if (left === null || right === null) return false

  switch (condition.operator) {
    case 'gt':
      return left > right
    case 'lt':
      return left < right

    case 'crossesAbove':
    case 'crossesBelow': {
      const previousLeft = evaluateOperand(condition.left, closes, 1)
      const previousRight = evaluateOperand(condition.right, closes, 1)
      if (previousLeft === null || previousRight === null) return false

      return condition.operator === 'crossesAbove'
        ? previousLeft <= previousRight && left > right
        : previousLeft >= previousRight && left < right
    }

    default:
      return false
  }
}

/**
 * Whether a whole rule holds.
 *
 * An empty rule is false, not true. It is not "no conditions, so everything
 * passes" — it is a rule nobody finished writing, and treating it as always-true
 * would make an unfinished strategy trade every single bar.
 */
export function evaluateRule(rule: Rule, closes: number[]): boolean {
  if (rule.conditions.length === 0) return false
  return rule.combinator === 'and'
    ? rule.conditions.every((condition) => evaluateCondition(condition, closes))
    : rule.conditions.some((condition) => evaluateCondition(condition, closes))
}

/**
 * Turn a strategy into the `SignalFn` the backtester already takes.
 *
 * Nothing about the backtester changes to accommodate the sandbox: a clicked
 * strategy and a hand-written one are the same type, run through the same
 * engine, and inherit the same execute-at-next-bar rule.
 *
 * When both rules fire the answer is `hold`. Preferring buy would be a silent
 * tie-break that hides a contradictory strategy behind a plausible backtest.
 */
export function compileStrategy(strategy: Strategy): SignalFn | null {
  if (!validateStrategy(strategy).valid) return null

  return (closesToDate: number[]): SignalAction => {
    const buy = evaluateRule(strategy.buy, closesToDate)
    const sell = evaluateRule(strategy.sell, closesToDate)

    if (buy && sell) return 'hold'
    if (buy) return 'buy'
    if (sell) return 'sell'
    return 'hold'
  }
}

export type ValidationResult = {
  valid: boolean
  errors: string[]
  warnings: string[]
  /** Longest indicator period in the strategy, so a caller can size the warmup. */
  longestPeriod: number
}

/** Two conditions that mean the same thing, however they were built. */
function sameCondition(a: Condition, b: Condition): boolean {
  return (
    a.operator === b.operator && sameOperand(a.left, b.left) && sameOperand(a.right, b.right)
  )
}

function sameOperand(a: Operand, b: Operand): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'constant' && b.kind === 'constant') return a.value === b.value
  if (a.kind === 'indicator' && b.kind === 'indicator') {
    return a.indicator === b.indicator && periodFor(a) === periodFor(b)
  }
  return false
}

/**
 * Check a strategy before it is run, and say what is wrong in words.
 *
 * The warnings matter as much as the errors. A rule comparing an indicator
 * against itself is never true, and its backtest looks exactly like a strategy
 * that chose not to trade — so the interface has to say so rather than letting
 * a flat equity curve be interpreted as caution.
 */
export function validateStrategy(strategy: Strategy): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []
  let longestPeriod = 0

  if (!strategy.name || strategy.name.trim().length === 0) {
    errors.push('La estrategia necesita un nombre.')
  }

  if (strategy.buy.conditions.length === 0) {
    errors.push('Sin al menos una condición de compra la estrategia nunca entraría al mercado.')
  }

  const allConditions = [
    ...strategy.buy.conditions.map((c) => ({ condition: c, side: 'compra' })),
    ...strategy.sell.conditions.map((c) => ({ condition: c, side: 'venta' })),
  ]

  for (const { condition, side } of allConditions) {
    for (const operand of [condition.left, condition.right]) {
      if (operand.kind === 'constant') {
        if (!Number.isFinite(operand.value)) {
          errors.push(`Una condición de ${side} tiene un valor que no es un número.`)
        }
        continue
      }

      const spec = INDICATOR_SPECS.find((s) => s.id === operand.indicator)
      if (!spec) {
        errors.push(`Indicador desconocido en una condición de ${side}.`)
        continue
      }
      if (!spec.hasPeriod) continue

      const period = periodFor(operand)
      if (!Number.isInteger(period) || period < MIN_PERIOD || period > MAX_PERIOD) {
        errors.push(
          `El periodo de ${spec.label} en una condición de ${side} debe ser un número entero entre ${MIN_PERIOD} y ${MAX_PERIOD}.`,
        )
        continue
      }
      longestPeriod = Math.max(longestPeriod, period)
    }

    if (sameOperand(condition.left, condition.right)) {
      warnings.push(
        `Una condición de ${side} compara algo consigo mismo, así que nunca se cumplirá. El backtest saldría plano y parecerá que la estrategia decidió no operar.`,
      )
    }
  }

  // Repeated conditions. Found by watching someone use the builder: clicking
  // "+ Condicion" adds the same default each time, so three clicks give three
  // identical rows. Under AND that changes nothing whatsoever, and the rule
  // reads itself back as "... y Precio es mayor que SMA de 20" three times.
  // Harmless to the maths, and exactly the kind of thing that makes a reader
  // trust a rule they did not actually write.
  for (const [side, rule] of [
    ['compra', strategy.buy],
    ['venta', strategy.sell],
  ] as const) {
    const counted = new Map<number, number>()
    rule.conditions.forEach((condition, index) => {
      const firstMatch = rule.conditions.findIndex((other) => sameCondition(other, condition))
      if (firstMatch < index) counted.set(firstMatch, (counted.get(firstMatch) ?? 1) + 1)
    })

    for (const [index, times] of counted) {
      warnings.push(
        `La condición de ${side} "${describeCondition(rule.conditions[index])}" está repetida ${times} veces. ` +
          (rule.combinator === 'and'
            ? 'Con "todas (Y)" repetirla no cambia nada: la regla se comporta como si estuviera una sola vez.'
            : 'Con "cualquiera (O)" repetirla tampoco cambia nada.'),
      )
    }
  }

  if (strategy.sell.conditions.length === 0) {
    warnings.push(
      'Sin condición de venta la estrategia compra y nunca sale, que es básicamente comprar y mantener. No es un error, pero conviene saberlo antes de leer el resultado.',
    )
  }

  return { valid: errors.length === 0, errors, warnings, longestPeriod }
}

function describeOperand(operand: Operand): string {
  if (operand.kind === 'constant') return String(operand.value)
  const spec = INDICATOR_SPECS.find((s) => s.id === operand.indicator)
  if (!spec) return operand.indicator
  return spec.hasPeriod ? `${spec.label} de ${periodFor(operand)}` : spec.label
}

/** One condition as a phrase. */
function describeCondition(condition: Condition): string {
  const operator = OPERATORS.find((o) => o.id === condition.operator)
  return `${describeOperand(condition.left)} ${operator?.label ?? condition.operator} ${describeOperand(condition.right)}`
}

/** A rule as a sentence someone can check without reading the data structure. */
export function describeRule(rule: Rule): string {
  if (rule.conditions.length === 0) return 'Sin condiciones.'
  return rule.conditions.map(describeCondition).join(rule.combinator === 'and' ? ' y ' : ' o ') + '.'
}

export type ExampleStrategy = {
  id: string
  strategy: Strategy
  description: string
}

const indicator = (id: IndicatorId, period?: number): Operand => ({
  kind: 'indicator',
  indicator: id,
  ...(period !== undefined ? { period } : {}),
})
const constant = (value: number): Operand => ({ kind: 'constant', value })

/**
 * Four starting points, each a well-known idea rather than an invention.
 *
 * They exist to be modified and, more importantly, to be BEATEN by buy-and-hold
 * in the backtest — which is what the comparison line in the results is for.
 */
export const EXAMPLE_STRATEGIES: ExampleStrategy[] = [
  {
    id: 'smaCross',
    strategy: {
      name: 'Cruce de medias (20/50)',
      buy: {
        combinator: 'and',
        conditions: [
          { left: indicator('sma', 20), operator: 'crossesAbove', right: indicator('sma', 50) },
        ],
      },
      sell: {
        combinator: 'and',
        conditions: [
          { left: indicator('sma', 20), operator: 'crossesBelow', right: indicator('sma', 50) },
        ],
      },
    },
    description:
      'La idea más antigua del análisis técnico: comprar cuando la media corta cruza por encima de la larga y vender cuando la cruza por debajo. Entra tarde y sale tarde por construcción, porque una media solo se mueve después de que el precio ya lo hizo.',
  },
  {
    id: 'rsiReversion',
    strategy: {
      name: 'Reversion por RSI',
      buy: {
        combinator: 'and',
        conditions: [{ left: indicator('rsi', 14), operator: 'lt', right: constant(30) }],
      },
      sell: {
        combinator: 'and',
        conditions: [{ left: indicator('rsi', 14), operator: 'gt', right: constant(70) }],
      },
    },
    description:
      'Apuesta a que lo que cae mucho rebota: compra en sobreventa y vende en sobrecompra. Funciona en mercados laterales y se destroza en tendencias, porque un activo que cae puede quedarse en RSI 25 mientras sigue cayendo.',
  },
  {
    id: 'bollingerBreakout',
    strategy: {
      name: 'Ruptura de Bollinger',
      buy: {
        combinator: 'and',
        conditions: [
          { left: indicator('price'), operator: 'crossesAbove', right: indicator('bollingerUpper', 20) },
        ],
      },
      sell: {
        combinator: 'and',
        conditions: [
          { left: indicator('price'), operator: 'crossesBelow', right: indicator('bollingerMiddle', 20) },
        ],
      },
    },
    description:
      'Lo contrario de la anterior: asume que salirse de la banda superior es señal de fuerza, no de exceso. Compra la ruptura y sale al volver a la media. Las dos ideas son incompatibles y las dos tienen defensores, que es justamente la lección.',
  },
  {
    id: 'momentum',
    strategy: {
      name: 'Momentum simple',
      buy: {
        combinator: 'and',
        conditions: [
          { left: indicator('price'), operator: 'gt', right: indicator('sma', 200) },
          { left: indicator('rsi', 14), operator: 'gt', right: constant(50) },
        ],
      },
      sell: {
        combinator: 'or',
        conditions: [
          { left: indicator('price'), operator: 'lt', right: indicator('sma', 200) },
        ],
      },
    },
    description:
      'Estar dentro solo mientras el activo esté por encima de su media de 200 días y con fuerza. Es la regla que más reduce las caídas grandes de esta lista, y la que más rendimiento deja sobre la mesa cuando el mercado se recupera rápido.',
  },
]
