// Goal tracking — pure functions, no I/O.
//
// The subtle part is what "on plan" means. Compounding is back-loaded: a plan
// that reaches a million in ten years is nowhere near half a million at year
// five, because most of the growth happens on a balance that only exists later.
// Comparing actual progress against a STRAIGHT LINE from start to target would
// therefore tell almost every investor they are behind for most of the horizon,
// which is both wrong and the single most discouraging thing this feature could
// do.
//
// So the comparison is against the plan's own curve at that moment, not against
// a linear ideal.

import { roundMoney, subtractMoney } from '@/lib/utils/money'

const MONTHS_PER_YEAR = 12

export type GoalSnapshot = {
  targetAmount: number
  /** ISO date the goal began. */
  startDate: string
  /** ISO date the goal is meant to be reached. */
  targetDate: string
  startingCapital: number
  plannedMonthlyContribution: number
  /** Expected annual return as a fraction. */
  expectedAnnualReturn: number
}

export type GoalActuals = {
  currentValue: number
  /** Everything actually paid in, including the starting capital. */
  contributedToDate: number
}

function monthlyRate(annual: number): number {
  // Floored the same way the advisor floors it: below -100% the root is NaN.
  return Math.pow(1 + Math.max(-0.99, annual), 1 / MONTHS_PER_YEAR) - 1
}

function monthsBetween(from: string, to: Date): number {
  const start = Date.parse(`${from}T00:00:00Z`)
  if (!Number.isFinite(start)) return 0
  const months = (to.getTime() - start) / (365.25 / 12) / 86_400_000
  return Math.max(0, Math.round(months))
}

function totalMonths(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`)
  const end = Date.parse(`${to}T00:00:00Z`)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0
  return Math.max(1, Math.round((end - start) / (365.25 / 12) / 86_400_000))
}

/**
 * What the plan says the balance should be `month` months in.
 *
 * This is the annuity curve, not a straight line. At the midpoint of a ten-year
 * plan it sits well below half the final figure, and that gap IS the compounding
 * — reporting it as a shortfall would be reporting arithmetic as failure.
 */
export function expectedProgressAt(goal: GoalSnapshot, month: number): number {
  const months = Math.max(0, Math.floor(month))
  const rate = monthlyRate(goal.expectedAnnualReturn)

  let value = goal.startingCapital
  for (let i = 0; i < months; i++) {
    value = value * (1 + rate) + goal.plannedMonthlyContribution
  }
  return Number.isFinite(value) ? value : goal.startingCapital
}

export type GoalProgress = {
  currentValue: number
  /** How far the money has come, capped at 100. */
  progressPct: number
  /** How far the clock has come. Deliberately separate from the money. */
  timeElapsedPct: number
  monthsElapsed: number
  monthsRemaining: number
  /** What the plan's own curve says the balance should be right now. */
  expectedValue: number
  /** Actual minus expected, in money. */
  deviation: number
  /** The same gap as a percentage of what was expected. */
  deviationPct: number
  plannedContributedToDate: number
  contributedToDate: number
  /** Planned minus actual contributions. Positive means paying in less than planned. */
  contributionShortfall: number
  reached: boolean
}

export function goalProgress(
  goal: GoalSnapshot,
  actuals: GoalActuals,
  asOf: Date = new Date(),
): GoalProgress | null {
  if (!Number.isFinite(goal.targetAmount) || goal.targetAmount <= 0) return null

  const horizonMonths = totalMonths(goal.startDate, goal.targetDate)
  if (horizonMonths === 0) return null

  const elapsed = Math.min(horizonMonths, monthsBetween(goal.startDate, asOf))
  const expectedValue = roundMoney(expectedProgressAt(goal, elapsed))
  const currentValue = Number.isFinite(actuals.currentValue) ? actuals.currentValue : 0
  const contributedToDate = Number.isFinite(actuals.contributedToDate)
    ? actuals.contributedToDate
    : 0

  const plannedContributedToDate = roundMoney(
    goal.startingCapital + goal.plannedMonthlyContribution * elapsed,
  )

  const deviation = subtractMoney(currentValue, expectedValue)

  return {
    currentValue,
    // Capped: a goal exceeded threefold is still "reached", and 340% on a
    // progress bar is a rendering bug waiting to happen.
    progressPct: Math.min(100, (currentValue / goal.targetAmount) * 100),
    timeElapsedPct: (elapsed / horizonMonths) * 100,
    monthsElapsed: elapsed,
    monthsRemaining: Math.max(0, horizonMonths - elapsed),
    expectedValue,
    deviation,
    deviationPct: expectedValue > 0 ? (deviation / expectedValue) * 100 : 0,
    plannedContributedToDate,
    contributedToDate,
    contributionShortfall: subtractMoney(plannedContributedToDate, contributedToDate),
    reached: currentValue >= goal.targetAmount,
  }
}

export type Pace = 'ahead' | 'on-track' | 'behind' | 'unknown'

/** Inside this band, a plan and reality have not meaningfully diverged. */
const ON_TRACK_BAND_PCT = 10

/**
 * Turn the gap against plan into a verdict and a sentence.
 *
 * The band exists because a projection is not a timetable. Being 3% off a
 * ten-year curve after two years says nothing at all, and flagging it would
 * train a reader to ignore the indicator by the time it matters.
 */
export function classifyPace(deviationPct: number): { pace: Pace; message: string } {
  if (!Number.isFinite(deviationPct)) {
    return {
      pace: 'unknown',
      message: 'No hay datos suficientes para comparar tu avance con el plan.',
    }
  }

  if (deviationPct > ON_TRACK_BAND_PCT) {
    return {
      pace: 'ahead',
      message:
        'Vas ' +
        deviationPct.toFixed(1) +
        '% por encima de lo que proyectaba el plan a estas alturas. Eso no significa que puedas ' +
        'bajar el ritmo: la ventaja viene en buena parte del mercado, y el mercado la puede ' +
        'devolver. Lo que sí puedes hacer es revisar si la meta se quedó corta.',
    }
  }

  if (deviationPct < -ON_TRACK_BAND_PCT) {
    return {
      pace: 'behind',
      message:
        'Vas ' +
        Math.abs(deviationPct).toFixed(1) +
        '% por debajo de lo que proyectaba el plan a estas alturas. Estar detrás de una ' +
        'proyección no es haber fallado: la proyección asumía un rendimiento promedio y el ' +
        'mercado no entrega promedios año con año. Revisa si la diferencia viene de aportar ' +
        'menos de lo planeado, que sí está en tus manos, o del rendimiento, que no.',
    }
  }

  return {
    pace: 'on-track',
    message:
      'Tu avance está dentro de un margen de ' +
      ON_TRACK_BAND_PCT +
      '% respecto al plan. Una proyección no es un calendario: diferencias de este tamaño son ' +
      'ruido normal y no piden ningún ajuste.',
  }
}
