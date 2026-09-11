// Rolling risk metrics — pure functions, no I/O.
//
// A single volatility number for the whole history answers "how bumpy has this
// been on average", which is almost never the question. The useful question is
// "was it always this bumpy, or is it getting worse", and that needs the metric
// recomputed over a moving window.
//
// Every function here returns null for a window it cannot honestly fill. That is
// deliberate and non-negotiable: a half-filled window produces a number that
// looks exactly like a real one, and the roadmap forbids letting an invalid or
// unfounded value reach the interface.

/** Trading days per year — the convention used everywhere else in the app. */
const TRADING_DAYS = 252

/**
 * Below this, a standard deviation is float dust, not variation.
 *
 * Summing and re-dividing identical floats leaves residue around 1e-17, and a
 * flat series divided by that residue produced a Sharpe of -15.96 once already.
 * Same guard, same reason.
 */
const MIN_MEANINGFUL_DEVIATION = 1e-10

export type RollingOptions = { annualise?: boolean }

/** Sample standard deviation, or null if the slice is unusable. */
function sampleDeviation(slice: number[]): number | null {
  if (slice.length < 2) return null
  if (!slice.every(Number.isFinite)) return null

  const mean = slice.reduce((a, b) => a + b, 0) / slice.length
  const variance =
    slice.reduce((sum, value) => sum + (value - mean) * (value - mean), 0) / (slice.length - 1)

  if (!Number.isFinite(variance) || variance < 0) return null
  return Math.sqrt(variance)
}

function isUsableWindow(returns: number[], window: number): boolean {
  return Number.isInteger(window) && window >= 2 && window <= returns.length
}

/**
 * Standard deviation of returns over a moving window, annualised by default.
 *
 * One entry per input observation. The first `window - 1` are null, because that
 * is what an unfilled window is worth.
 */
export function rollingVolatility(
  returns: number[],
  window: number,
  options: RollingOptions = {},
): (number | null)[] {
  const out: (number | null)[] = Array(returns.length).fill(null)
  if (!isUsableWindow(returns, window)) return out

  const factor = options.annualise === false ? 1 : Math.sqrt(TRADING_DAYS)

  for (let end = window - 1; end < returns.length; end++) {
    const deviation = sampleDeviation(returns.slice(end - window + 1, end + 1))
    if (deviation === null) continue
    const value = deviation * factor
    if (Number.isFinite(value)) out[end] = value
  }

  return out
}

/**
 * Pearson correlation between two aligned return series over a moving window.
 *
 * Returns an empty array — not a series of nulls — when the two series are not
 * the same length, because that is a caller bug rather than missing data, and
 * the two deserve to look different.
 */
export function rollingCorrelation(
  a: number[],
  b: number[],
  window: number,
): (number | null)[] {
  if (a.length !== b.length) return []

  const out: (number | null)[] = Array(a.length).fill(null)
  if (!isUsableWindow(a, window)) return out

  for (let end = window - 1; end < a.length; end++) {
    const from = end - window + 1
    const sliceA = a.slice(from, end + 1)
    const sliceB = b.slice(from, end + 1)

    const devA = sampleDeviation(sliceA)
    const devB = sampleDeviation(sliceB)
    if (devA === null || devB === null) continue
    // A window with no variation has no correlation to report. Zero would be a
    // claim ("they are unrelated"); null is the truth ("this cannot be answered").
    if (devA < MIN_MEANINGFUL_DEVIATION || devB < MIN_MEANINGFUL_DEVIATION) continue

    const meanA = sliceA.reduce((x, y) => x + y, 0) / window
    const meanB = sliceB.reduce((x, y) => x + y, 0) / window
    let covariance = 0
    for (let i = 0; i < window; i++) {
      covariance += (sliceA[i] - meanA) * (sliceB[i] - meanB)
    }
    covariance /= window - 1

    const correlation = covariance / (devA * devB)
    if (!Number.isFinite(correlation)) continue
    // Float error can push a perfect correlation a hair past 1.
    out[end] = Math.min(1, Math.max(-1, correlation))
  }

  return out
}

/**
 * Sharpe ratio over a moving window.
 *
 * `riskFreeAnnual` is a decimal fraction (0.04 for 4%) and should come from
 * `getRiskFreeRate`, not from a number typed into a component.
 */
export function rollingSharpe(
  returns: number[],
  window: number,
  riskFreeAnnual: number,
): (number | null)[] {
  const out: (number | null)[] = Array(returns.length).fill(null)
  if (!isUsableWindow(returns, window)) return out
  if (!Number.isFinite(riskFreeAnnual)) return out

  for (let end = window - 1; end < returns.length; end++) {
    const slice = returns.slice(end - window + 1, end + 1)
    const deviation = sampleDeviation(slice)
    if (deviation === null || deviation < MIN_MEANINGFUL_DEVIATION) continue

    const meanDaily = slice.reduce((a, b) => a + b, 0) / window
    const annualReturn = meanDaily * TRADING_DAYS
    const annualVolatility = deviation * Math.sqrt(TRADING_DAYS)

    const sharpe = (annualReturn - riskFreeAnnual) / annualVolatility
    if (Number.isFinite(sharpe)) out[end] = sharpe
  }

  return out
}

export type RollingRiskPoint = {
  date: string
  /** Annualised, as a percentage. Null during the warmup. */
  volatilityPct: number | null
  sharpe: number | null
  /** Against the benchmark, when one was supplied. */
  correlation: number | null
}

export type RollingRiskSeries = {
  window: number
  /** How many points actually carry a metric, as opposed to warmup nulls. */
  observationsUsed: number
  points: RollingRiskPoint[]
}

export type RollingRiskOptions = {
  window: number
  riskFreeAnnual?: number
  benchmarkReturns?: number[]
}

/**
 * All three rolling metrics, each pinned to the date it describes.
 *
 * Returns null rather than a partial series when the inputs do not line up, so
 * a caller cannot accidentally plot returns against the wrong dates.
 */
export function rollingRiskSeries(
  dates: string[],
  returns: number[],
  options: RollingRiskOptions,
): RollingRiskSeries | null {
  const { window, riskFreeAnnual = 0, benchmarkReturns } = options

  if (dates.length !== returns.length) return null
  if (!isUsableWindow(returns, window)) return null

  const volatility = rollingVolatility(returns, window)
  const sharpe = rollingSharpe(returns, window, riskFreeAnnual)
  const correlation =
    benchmarkReturns && benchmarkReturns.length === returns.length
      ? rollingCorrelation(returns, benchmarkReturns, window)
      : null

  const points: RollingRiskPoint[] = dates.map((date, i) => {
    const vol = volatility[i]
    return {
      date,
      volatilityPct: vol === null ? null : vol * 100,
      sharpe: sharpe[i],
      correlation: correlation ? (correlation[i] ?? null) : null,
    }
  })

  return {
    window,
    observationsUsed: points.filter((p) => p.volatilityPct !== null).length,
    points,
  }
}

export type StressPeriod = {
  fromDate: string
  toDate: string
  peakVolatilityPct: number
  /** The series' own normal level, for context. */
  medianVolatilityPct: number
  multipleOfNormal: number
  label: string
}

/**
 * How far above its own normal a stretch must run to count as stress.
 *
 * Measured against the median rather than the mean on purpose: the mean is
 * dragged up by the very spikes being looked for, which would hide them.
 */
const STRESS_MULTIPLE = 1.5

/** Shorter runs than this are noise, not a period. */
const MIN_STRESS_RUN = 2

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

/**
 * The stretches where this portfolio's own volatility ran far above its normal.
 *
 * This is descriptive, not predictive: it reports when the past was turbulent.
 * It says nothing about what comes next, and must never be labelled as though
 * it did.
 */
export function detectStressPeriods(series: RollingRiskSeries): StressPeriod[] {
  const usable = series.points.filter(
    (p): p is RollingRiskPoint & { volatilityPct: number } => p.volatilityPct !== null,
  )
  if (usable.length < MIN_STRESS_RUN) return []

  const normal = median(usable.map((p) => p.volatilityPct))
  if (!(normal > 0)) return []

  const threshold = normal * STRESS_MULTIPLE
  const periods: StressPeriod[] = []
  let run: (RollingRiskPoint & { volatilityPct: number })[] = []

  const close = () => {
    if (run.length >= MIN_STRESS_RUN) {
      const peak = Math.max(...run.map((p) => p.volatilityPct))
      const multiple = peak / normal
      periods.push({
        fromDate: run[0].date,
        toDate: run[run.length - 1].date,
        peakVolatilityPct: peak,
        medianVolatilityPct: normal,
        multipleOfNormal: multiple,
        label:
          `Del ${run[0].date} al ${run[run.length - 1].date} (${run.length} dias) la volatilidad ` +
          `llego al ${peak.toFixed(1)}% anual, ${multiple.toFixed(1)} veces su nivel normal del ` +
          `${normal.toFixed(1)}%. Describe lo que ya paso; no dice nada sobre lo que viene.`,
      })
    }
    run = []
  }

  for (const point of usable) {
    if (point.volatilityPct > threshold) run.push(point)
    else close()
  }
  close()

  return periods
}
