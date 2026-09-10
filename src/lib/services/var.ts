// Value at Risk — pure functions, no I/O.
//
// "How bad is a bad day?" has more than one defensible answer, and the gap
// between the answers is itself the information.
//
//   historical  — the loss the sample actually delivered at that percentile.
//                 Assumes nothing about shape, but can only report losses that
//                 already happened; with 250 days of history the 99th
//                 percentile rests on two or three observations.
//   parametric  — the normal-distribution quantile. Smooth and stable, but
//                 market returns are not normal, and the way they are not
//                 normal is precisely the way that matters: losses cluster
//                 and extremes are far more common than a bell curve allows.
//   Cornish-Fisher — the normal quantile corrected for the sample's actual
//                 skew and fat tails. Keeps the stability of the parametric
//                 estimate while admitting the shape.
//   CVaR        — the average loss GIVEN that the VaR threshold was breached.
//                 VaR says how far down the cliff edge is; CVaR says how far
//                 the drop goes.
//
// All four are reported together. A large gap between the normal and
// Cornish-Fisher figures is a reader's signal that the shape matters here.
//
// Losses are quoted as positive magnitudes throughout: "you could lose 4.6%",
// not "-4.6%".

/** Below this a third or fourth moment is noise rather than an estimate. */
const MIN_OBSERVATIONS_FOR_MOMENTS = 4
const MIN_OBSERVATIONS_FOR_TAIL = 10
/** Dispersion below this is float dust from a constant series, not variation. */
const MIN_STDDEV = 1e-12

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length
}

/** Sample standard deviation, n-1 denominator, matching analytics.ts. */
function sampleStdDev(values: number[]): number {
  const m = mean(values)
  const variance = values.reduce((sum, v) => sum + (v - m) ** 2, 0) / (values.length - 1)
  return Math.sqrt(variance)
}

function usable(values: number[], minimum: number): boolean {
  return values.length >= minimum && values.every((v) => Number.isFinite(v))
}

/**
 * Sample skewness (Fisher-Pearson, bias-corrected).
 *
 * Negative means the long tail is on the loss side — rare large drops with many
 * small gains, which is the shape most equity portfolios actually have and the
 * one a normal model flatters.
 */
export function skewness(returns: number[]): number | null {
  if (!usable(returns, MIN_OBSERVATIONS_FOR_MOMENTS)) return null

  const n = returns.length
  const m = mean(returns)
  const sd = sampleStdDev(returns)
  if (!(sd > MIN_STDDEV)) return null

  const sum = returns.reduce((acc, v) => acc + ((v - m) / sd) ** 3, 0)
  const result = (n / ((n - 1) * (n - 2))) * sum
  return Number.isFinite(result) ? result : null
}

/**
 * Excess kurtosis: kurtosis minus 3, so a normal distribution scores 0.
 *
 * Positive means fatter tails than normal — extremes happen more often than a
 * bell curve predicts, which is the single most consequential way real returns
 * depart from the textbook.
 */
export function excessKurtosis(returns: number[]): number | null {
  if (!usable(returns, MIN_OBSERVATIONS_FOR_MOMENTS + 1)) return null

  const n = returns.length
  const m = mean(returns)
  const sd = sampleStdDev(returns)
  if (!(sd > MIN_STDDEV)) return null

  const sum = returns.reduce((acc, v) => acc + ((v - m) / sd) ** 4, 0)
  const g2 =
    ((n * (n + 1)) / ((n - 1) * (n - 2) * (n - 3))) * sum -
    (3 * (n - 1) ** 2) / ((n - 2) * (n - 3))
  return Number.isFinite(g2) ? g2 : null
}

/**
 * The standard normal quantile, Acklam's rational approximation.
 * Accurate to about 1.15e-9 across the whole range, which is far past what any
 * risk figure resting on a few hundred observations can justify.
 */
function normalQuantile(p: number): number {
  if (p <= 0 || p >= 1) return Number.NaN

  const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269,
    -30.6647980661472, 2.50662827745924]
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197,
    -13.2806815528857]
  const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373,
    4.37466414146497, 2.93816398269878]
  const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742]

  const pLow = 0.02425
  const pHigh = 1 - pLow

  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p))
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    )
  }
  if (p > pHigh) {
    const q = Math.sqrt(-2 * Math.log(1 - p))
    return -(
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    )
  }

  const q = p - 0.5
  const r = q * q
  return (
    ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
  )
}

/** The tail probability a confidence level implies: 95 -> 0.05. */
function tailProbability(confidence: number): number {
  return 1 - confidence / 100
}

/**
 * Historical VaR: the loss the sample itself delivered at this percentile.
 *
 * Makes no assumption about shape, which is its strength and its weakness — it
 * cannot report a loss worse than the worst one already observed.
 */
export function historicalVaR(returns: number[], confidence = 95): number | null {
  if (!usable(returns, MIN_OBSERVATIONS_FOR_TAIL)) return null
  if (confidence <= 0 || confidence >= 100) return null

  const sorted = [...returns].sort((a, b) => a - b)
  const index = Math.max(
    0,
    Math.min(sorted.length - 1, Math.floor(tailProbability(confidence) * sorted.length)),
  )
  // A sample where even the tail made money has no loss to report.
  return Math.max(0, -sorted[index])
}

/**
 * Parametric (normal) VaR from a mean and a standard deviation.
 *
 * Stable and smooth, and wrong in a specific direction: real returns have
 * fatter tails than a normal curve, so this understates how bad a bad day gets.
 */
export function parametricVaR(
  meanReturn: number,
  stdDev: number,
  confidence = 95,
): number | null {
  if (!Number.isFinite(meanReturn) || !Number.isFinite(stdDev) || stdDev < 0) return null
  if (confidence <= 0 || confidence >= 100) return null

  const z = normalQuantile(tailProbability(confidence))
  if (!Number.isFinite(z)) return null

  return Math.max(0, -(meanReturn + z * stdDev))
}

/**
 * Cornish-Fisher VaR: the normal quantile expanded to admit the sample's own
 * skew and fat tails.
 *
 *   z_cf = z + (z²-1)·S/6 + (z³-3z)·K/24 - (2z³-5z)·S²/36
 *
 * Where S is skewness and K excess kurtosis. With both at zero the correction
 * terms vanish and this reduces exactly to the normal quantile, which is what
 * makes it a strict improvement rather than a different model — a property the
 * tests assert directly.
 *
 * The expansion is a third-order approximation and misbehaves for extreme
 * moments; the caller is expected to show it alongside the historical figure
 * rather than in place of it.
 */
export function cornishFisherVaR(
  meanReturn: number,
  stdDev: number,
  skew: number | null,
  kurtosis: number | null,
  confidence = 95,
): number | null {
  if (skew === null || kurtosis === null) return null
  if (!Number.isFinite(meanReturn) || !Number.isFinite(stdDev) || stdDev < 0) return null
  if (!Number.isFinite(skew) || !Number.isFinite(kurtosis)) return null
  if (confidence <= 0 || confidence >= 100) return null

  const z = normalQuantile(tailProbability(confidence))
  if (!Number.isFinite(z)) return null

  const zcf =
    z +
    ((z * z - 1) * skew) / 6 +
    ((z * z * z - 3 * z) * kurtosis) / 24 -
    ((2 * z * z * z - 5 * z) * skew * skew) / 36

  if (!Number.isFinite(zcf)) return null
  return Math.max(0, -(meanReturn + zcf * stdDev))
}

/**
 * Conditional VaR, also called expected shortfall: the average loss on the days
 * that breached the VaR threshold.
 *
 * VaR says how far down the cliff edge is. CVaR says how far the drop goes,
 * which is the question anyone standing on the edge actually cares about. It is
 * never smaller than the VaR at the same confidence, and the tests assert that.
 */
export function conditionalVaR(returns: number[], confidence = 95): number | null {
  if (!usable(returns, MIN_OBSERVATIONS_FOR_TAIL)) return null
  if (confidence <= 0 || confidence >= 100) return null

  const sorted = [...returns].sort((a, b) => a - b)
  const cutoff = Math.max(
    1,
    Math.min(sorted.length, Math.floor(tailProbability(confidence) * sorted.length) + 1),
  )
  const tail = sorted.slice(0, cutoff)
  return Math.max(0, -mean(tail))
}

export type TailRisk = {
  confidence: number
  observations: number
  /** All quoted as positive percentages. Null where the estimate is unavailable. */
  historicalPct: number | null
  parametricPct: number | null
  cornishFisherPct: number | null
  conditionalPct: number | null
  skewness: number | null
  excessKurtosis: number | null
  interpretation: string
}

/**
 * Every tail measure side by side, plus a sentence about which to weigh.
 *
 * Reporting them together is the point. One number labelled "VaR" invites a
 * reader to treat it as the answer; four numbers that disagree invite them to
 * ask why, which is the thing worth learning.
 */
export function analyseTailRisk(returns: number[], confidence = 95): TailRisk | null {
  if (!usable(returns, MIN_OBSERVATIONS_FOR_TAIL)) return null

  const m = mean(returns)
  const sd = sampleStdDev(returns)
  const skew = skewness(returns)
  const kurt = excessKurtosis(returns)

  const historical = historicalVaR(returns, confidence)
  const parametric = parametricVaR(m, sd, confidence)
  const cornishFisher = cornishFisherVaR(m, sd, skew, kurt, confidence)
  const conditional = conditionalVaR(returns, confidence)

  const asPct = (value: number | null) => (value === null ? null : value * 100)

  return {
    confidence,
    observations: returns.length,
    historicalPct: asPct(historical),
    parametricPct: asPct(parametric),
    cornishFisherPct: asPct(cornishFisher),
    conditionalPct: asPct(conditional),
    skewness: skew,
    excessKurtosis: kurt,
    interpretation: interpret(confidence, parametric, cornishFisher, conditional, skew, kurt),
  }
}

/** Gap at which the normal model is materially understating the tail. */
const MATERIAL_GAP = 0.15

function interpret(
  confidence: number,
  parametric: number | null,
  cornishFisher: number | null,
  conditional: number | null,
  skew: number | null,
  kurtosis: number | null,
): string {
  const frequency = `On the worst ${(100 - confidence).toFixed(0)} days in 100, `

  if (parametric === null || cornishFisher === null) {
    return (
      frequency +
      'the historical figure is the only one available: this series is too short or too flat ' +
      'to estimate its shape.'
    )
  }

  const tail =
    conditional === null
      ? ''
      : ` When that threshold is breached, the average loss is ${(conditional * 100).toFixed(2)}% — that is the number to plan around, not the threshold itself.`

  const gap = parametric > 0 ? (cornishFisher - parametric) / parametric : 0

  if (gap > MATERIAL_GAP) {
    return (
      frequency +
      `a normal model expects a loss of ${(parametric * 100).toFixed(2)}%, but this portfolio's ` +
      `own shape — skew ${skew?.toFixed(2)}, excess kurtosis ${kurtosis?.toFixed(2)} — puts it at ` +
      `${(cornishFisher * 100).toFixed(2)}%. Losses here cluster more than a bell curve allows, so ` +
      'the normal figure understates the risk.' +
      tail
    )
  }

  if (gap < -MATERIAL_GAP) {
    return (
      frequency +
      `a normal model expects ${(parametric * 100).toFixed(2)}%, and this portfolio's shape puts it ` +
      `lower at ${(cornishFisher * 100).toFixed(2)}%: its large moves have been to the upside.` +
      tail
    )
  }

  return (
    frequency +
    `the loss is around ${(cornishFisher * 100).toFixed(2)}%. The normal model and the ` +
    'shape-corrected one broadly agree, so this distribution is close enough to a bell curve for ' +
    'either to be usable.' +
    tail
  )
}
