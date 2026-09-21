/**
 * Return calculations — pure functions, no I/O.
 *
 * Three methodologies, which answer three different questions:
 *
 * - Simple return: what is the book worth against what went in.
 * - TWR (time-weighted): how did the STRATEGY do, with the timing and size of
 *   contributions stripped out. This is what you compare against an index.
 * - MWR / XIRR (money-weighted): how did THE INVESTOR do, counting when each
 *   peso arrived. This is what actually happened to their wealth.
 *
 * They diverge whenever money arrives at uneven moments, and the gap is
 * informative rather than an error — see describeReturnDifference.
 *
 * Every function here returns null rather than 0 when it cannot answer. A zero
 * return and an unknown return look identical on a dashboard and mean opposite
 * things.
 */

export type Snapshot = { date: string; value: number }
export type CashFlow = { date: string; amount: number }

const MS_PER_YEAR = 365 * 24 * 60 * 60 * 1000
/** Half a cent: below it a book's value is $0.00 at the precision money.ts keeps. */
const EMPTY_BOOK = 0.005

/** Simple return as a percentage. */
export function calculateSimpleReturn(currentValue: number, totalCost: number): number {
  if (totalCost === 0) return 0
  return ((currentValue - totalCost) / totalCost) * 100
}

// ─── Time-weighted return ───────────────────────────────────────────────────

/**
 * Time-Weighted Return: the product of each sub-period's growth, so a
 * contribution changes the capital base without registering as performance.
 *
 * A flow dated D is treated as landing immediately after the snapshot dated D,
 * which is the convention the snapshots themselves follow — a snapshot records
 * the book before that day's activity.
 *
 * Returns a percentage, or null when the series cannot support the calculation.
 */
export function calculateTWR(snapshots: Snapshot[], cashFlows: CashFlow[]): number | null {
  if (snapshots.length < 2) return null

  const sorted = [...snapshots].sort((a, b) => a.date.localeCompare(b.date))

  let chained = 1
  for (let i = 1; i < sorted.length; i++) {
    const periodStart = sorted[i - 1].date
    const periodEnd = sorted[i].date

    // Flows from this period's opening snapshot up to (not including) the next
    // one adjust the capital the period starts with.
    let injected = 0
    for (const flow of cashFlows) {
      if (flow.date >= periodStart && flow.date < periodEnd) injected += flow.amount
    }

    const openingCapital = sorted[i - 1].value + injected
    // A period with nothing in it and nothing at the end — the days between
    // selling everything and buying back in — has no return, which is not the
    // same as an unmeasurable one. It is skipped rather than failing the chain.
    if (Math.abs(openingCapital) < EMPTY_BOOK && Math.abs(sorted[i].value) < EMPTY_BOOK) continue
    // A period that starts from nothing but ends with value has no return to
    // measure, and dividing by it would hand the interface an Infinity.
    if (openingCapital <= 0) return null

    chained *= sorted[i].value / openingCapital
  }

  if (!Number.isFinite(chained)) return null
  return (chained - 1) * 100
}

// ─── Money-weighted return (XIRR) ───────────────────────────────────────────

/** Net present value of dated flows at an annual rate. */
function netPresentValue(flows: CashFlow[], startMs: number, rate: number): number {
  let sum = 0
  for (const flow of flows) {
    const years = (Date.parse(flow.date) - startMs) / MS_PER_YEAR
    const factor = Math.pow(1 + rate, years)
    if (!Number.isFinite(factor) || factor === 0) return Number.NaN
    sum += flow.amount / factor
  }
  return sum
}

/**
 * XIRR: the annual rate at which the dated flows discount to zero.
 *
 * Solved by bracketing and bisection rather than Newton-Raphson alone. Newton
 * is faster but overshoots badly on short holding periods — a 9x gain in a
 * month implies an annual rate in the hundreds of billions of percent, and the
 * tangent step walks straight past it into a non-finite discount factor. The
 * previous implementation returned 0 when that happened, which reads on a
 * dashboard as "you made nothing" rather than "this did not converge".
 *
 * Returns a percentage, or null when no rate exists: fewer than two flows, no
 * sign change (money only ever went one way), or no elapsed time.
 */
export function calculateXIRR(flows: CashFlow[]): number | null {
  if (flows.length < 2) return null

  const dated = flows
    .filter((f) => Number.isFinite(Date.parse(f.date)) && Number.isFinite(f.amount))
    .sort((a, b) => a.date.localeCompare(b.date))
  if (dated.length < 2) return null

  const startMs = Date.parse(dated[0].date)
  const endMs = Date.parse(dated[dated.length - 1].date)
  if (endMs <= startMs) return null

  const hasInflow = dated.some((f) => f.amount > 0)
  const hasOutflow = dated.some((f) => f.amount < 0)
  if (!hasInflow || !hasOutflow) return null

  // Bracket the root. NPV falls as the rate rises for a conventional flow, so
  // expanding the upper bound eventually crosses zero; the lower bound sits
  // just above -100%, where the discount factor blows up.
  let low = -0.9999
  let high = 1
  let fLow = netPresentValue(dated, startMs, low)
  let fHigh = netPresentValue(dated, startMs, high)
  if (!Number.isFinite(fLow)) return null

  // A very short holding period produces an enormous annualised rate, so the
  // ceiling has to be generous. Such a number is mathematically correct but not
  // meaningful; deciding how to present it belongs to the caller.
  const MAX_RATE = 1e15
  while (Number.isFinite(fHigh) && fLow * fHigh > 0 && high < MAX_RATE) {
    high *= 4
    fHigh = netPresentValue(dated, startMs, high)
  }
  if (!Number.isFinite(fHigh) || fLow * fHigh > 0) return null

  for (let i = 0; i < 300; i++) {
    const mid = (low + high) / 2
    const fMid = netPresentValue(dated, startMs, mid)
    if (!Number.isFinite(fMid)) return null
    if (Math.abs(fMid) < 1e-9 || high - low < 1e-12) {
      return Number.isFinite(mid) ? mid * 100 : null
    }
    if (fLow * fMid < 0) {
      high = mid
      fHigh = fMid
    } else {
      low = mid
      fLow = fMid
    }
  }

  const rate = (low + high) / 2
  return Number.isFinite(rate) ? rate * 100 : null
}

/**
 * Money-Weighted Return: XIRR over the contributions plus the book's current
 * value as a closing inflow.
 *
 * Contributions must be negative and withdrawals positive, the usual cash-flow
 * sign convention.
 */
export function calculateMWR(
  cashFlows: CashFlow[],
  currentValue: number,
  endDate: Date,
): number | null {
  if (cashFlows.length === 0) return null
  if (!Number.isFinite(currentValue)) return null

  return calculateXIRR([
    ...cashFlows,
    { date: endDate.toISOString().slice(0, 10), amount: currentValue },
  ])
}

// ─── Explaining the gap ─────────────────────────────────────────────────────

/** Below this the two returns are the same answer to two questions. */
const AGREEMENT_THRESHOLD_PCT = 0.5

/**
 * Why the two returns differ, in the terms that actually caused it.
 *
 * The gap is not an error and neither number is more correct: TWR judges the
 * strategy, MWR judges the investor's timing on top of it. Returns null when
 * one side could not be computed, because there is nothing to compare.
 *
 * The two must be on the same basis first. calculateMWR is an annual rate;
 * calculateTWR is the cumulative return over whatever window it was given.
 * Pass `twrDays` and the TWR is annualised before the comparison — without it,
 * 19.52% over five months was reported as "0.97 points above" an 18.55% annual
 * rate, when on the same basis the gap was over thirty points.
 */
export function describeReturnDifference(
  twr: number | null,
  mwr: number | null,
  options: { twrDays?: number } = {},
): string | null {
  if (twr === null || mwr === null) return null
  if (!Number.isFinite(twr) || !Number.isFinite(mwr)) return null

  const days = options.twrDays
  const annualise = days !== undefined && Number.isFinite(days) && days > 0 && twr > -100
  const comparableTwr = annualise ? (Math.pow(1 + twr / 100, 365 / days!) - 1) * 100 : twr
  if (!Number.isFinite(comparableTwr)) return null

  const basis = annualise
    ? `El rendimiento ponderado por tiempo fue ${twr.toFixed(2)}% en ${Math.round(days!)} dias, ${comparableTwr.toFixed(2)}% anualizado, para compararlo con el ponderado por dinero, que ya es una tasa anual. `
    : ''
  const shortWindow =
    annualise && days! < 365
      ? ' Con menos de un ano de historia, ambas cifras anuales extrapolan: sirven para comparar entre si, no como pronostico.'
      : ''

  const gap = mwr - comparableTwr

  if (Math.abs(gap) < AGREEMENT_THRESHOLD_PCT) {
    return (
      basis +
      'Ambas medidas coinciden, asi que el momento de tus aportaciones ni ayudo ni perjudico: ' +
      'tu dinero vivio el mismo rendimiento que produjo la estrategia.' +
      shortWindow
    )
  }

  if (gap > 0) {
    return (
      basis +
      `Tu rendimiento ponderado por dinero es ${gap.toFixed(2)} puntos mayor que el ponderado por tiempo. ` +
      'Tu cuenta rindio mas que la estrategia, y la diferencia es el momento: una parte mayor de tu ' +
      'capital estuvo invertida durante los tramos buenos.' +
      shortWindow
    )
  }

  return (
    basis +
    `Tu rendimiento ponderado por dinero es ${Math.abs(gap).toFixed(2)} puntos menor que el ponderado por tiempo. ` +
    'La estrategia rindio mas que tu cuenta, y la diferencia es el momento: una parte mayor de tu ' +
    'capital llego tarde o antes de los tramos debiles. Es comun y no demuestra que la estrategia este mal.' +
    shortWindow
  )
}

const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * How long the invested money has actually been at work, in days, weighting
 * each contribution by its size.
 *
 * An annual XIRR on capital that has mostly been invested for a few weeks is
 * that few weeks' return raised to the power of a year. The date of the first
 * deposit does not say that — ten thousand invested ten months ago and thirty
 * thousand invested last month average three months, not ten. Withdrawals are
 * left out: they are capital leaving, not capital put to work.
 *
 * Null when nothing was invested.
 */
export function capitalWeightedAgeDays(flows: CashFlow[], endDate: Date): number | null {
  const end = endDate.getTime()
  let weighted = 0
  let invested = 0
  for (const flow of flows) {
    if (!(flow.amount < 0)) continue
    const size = -flow.amount
    const days = Math.max(0, (end - Date.parse(flow.date)) / MS_PER_DAY)
    weighted += size * days
    invested += size
  }
  if (!(invested > 0)) return null
  const age = weighted / invested
  return Number.isFinite(age) ? age : null
}

/** A year, in the days capitalWeightedAgeDays measures in. */
const DAYS_PER_YEAR = 365

export type MwrDisplay = {
  /** The figure to show, as a percentage. */
  value: number
  /** True when `value` is an annual rate; false when it covers `days` only. */
  annualised: boolean
  /** The span a non-annualised figure covers. Null when annualised. */
  days: number | null
}

/**
 * The money-weighted return as it should be shown.
 *
 * XIRR is always an annual rate. On capital that has been invested for a year
 * or more that is the honest figure. On capital three days old it is three
 * days' return raised to the power of a year: production showed a book up
 * 0.63% as "MWR +115.67% — Tu rendimiento real", next to a simple return of
 * +0.63% under the same "1Y" label. The global standard for performance
 * reporting (GIPS) says it flatly: returns for periods under a year must not
 * be annualised.
 *
 * So under a year the rate is taken back to the span the capital has actually
 * been invested — the inverse of the annualisation XIRR applied — and labelled
 * with that span. Null in, null out: no history is not a return of zero.
 */
export function mwrForDisplay(mwr: number | null | undefined, capitalAgeDays: number | null | undefined): MwrDisplay | null {
  if (mwr == null || !Number.isFinite(mwr)) return null
  if (capitalAgeDays == null || !(capitalAgeDays > 0) || capitalAgeDays >= DAYS_PER_YEAR) {
    return { value: mwr, annualised: true, days: null }
  }
  const growth = 1 + mwr / 100
  if (!(growth > 0)) return { value: mwr, annualised: true, days: null }
  const periodReturn = (Math.pow(growth, capitalAgeDays / DAYS_PER_YEAR) - 1) * 100
  return { value: periodReturn, annualised: false, days: capitalAgeDays }
}

// ─── Calendar returns ───────────────────────────────────────────────────────

export type CalendarYear = {
  year: number
  /** Twelve entries, January first; null for a month with no data. */
  months: (number | null)[]
  /** The months compounded, not added. */
  total: number
}

/**
 * Month-by-month time-weighted returns, grouped by year.
 *
 * Each month runs from the previous month's last snapshot to its own last one,
 * through calculateTWR, so money added during the month changes the capital
 * base without being reported as a gain. Measuring months as (end - start) /
 * start instead would call a month with a large deposit a spectacular return.
 * The year total compounds the months: +10% and +10% is +21%, not +20%.
 */
export function calendarReturns(snapshots: Snapshot[], cashFlows: CashFlow[]): CalendarYear[] {
  if (snapshots.length < 2) return []
  const sorted = [...snapshots].sort((a, b) => a.date.localeCompare(b.date))

  const lastIndexByMonth = new Map<string, number>()
  const firstIndexByMonth = new Map<string, number>()
  sorted.forEach((snapshot, index) => {
    const month = snapshot.date.slice(0, 7)
    if (!firstIndexByMonth.has(month)) firstIndexByMonth.set(month, index)
    lastIndexByMonth.set(month, index)
  })

  const years = new Map<number, (number | null)[]>()
  for (const [month, last] of lastIndexByMonth) {
    const first = firstIndexByMonth.get(month)!
    const from = first > 0 ? first - 1 : first
    const monthReturn = last > from ? calculateTWR(sorted.slice(from, last + 1), cashFlows) : null

    const year = Number(month.slice(0, 4))
    const monthIndex = Number(month.slice(5, 7)) - 1
    if (!years.has(year)) years.set(year, new Array<number | null>(12).fill(null))
    years.get(year)![monthIndex] = monthReturn
  }

  return [...years.entries()]
    .sort(([a], [b]) => a - b)
    .map(([year, months]) => ({
      year,
      months,
      total: (months.reduce<number>((growth, m) => growth * (1 + (m ?? 0) / 100), 1) - 1) * 100,
    }))
}
