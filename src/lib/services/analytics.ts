/**
 * Annualised volatility below this is float dust from a flat series, not risk.
 * A 0.01% daily move already annualises to roughly 0.0016.
 */
const MIN_MEANINGFUL_VOLATILITY = 1e-10

export function calculateVolatility(returns: number[]): number {
  if (returns.length < 2) return 0
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length
  const squaredDiffs = returns.map(r => Math.pow(r - mean, 2))
  const variance = squaredDiffs.reduce((a, b) => a + b, 0) / (returns.length - 1)
  return Math.sqrt(variance) * Math.sqrt(252) // Annualized
}

/**
 * Annualised excess return over annualised volatility.
 *
 * The zero-volatility guard is a threshold rather than an equality test. A
 * genuinely flat series does not produce a variance of exactly 0 — summing and
 * re-dividing identical floats leaves dust around 1e-17 — so `=== 0` never
 * fires and the ratio divides by that dust, turning a portfolio that did not
 * move into a Sharpe of -15.96. Same reasoning as MIN_BENCHMARK_VARIANCE below;
 * any real daily series sits far above this floor.
 */
export function calculateSharpeRatio(returns: number[], riskFreeRate: number): number {
  if (returns.length < 2) return 0
  const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length
  const annualizedReturn = meanReturn * 252
  const volatility = calculateVolatility(returns)
  if (!(volatility > MIN_MEANINGFUL_VOLATILITY)) return 0
  return (annualizedReturn - riskFreeRate) / volatility
}

export function calculateMaxDrawdown(values: number[]): number {
  if (values.length < 2) return 0
  let maxDrawdown = 0
  let peak = values[0]
  for (const value of values) {
    if (value > peak) peak = value
    const drawdown = (peak - value) / peak
    if (drawdown > maxDrawdown) maxDrawdown = drawdown
  }
  return maxDrawdown * 100 // As percentage
}

export function calculateDailyReturns(closes: number[]): number[] {
  const returns: number[] = []
  for (let i = 1; i < closes.length; i++) {
    returns.push((closes[i] - closes[i - 1]) / closes[i - 1])
  }
  return returns
}

const TRADING_DAYS = 252

/**
 * Minimum benchmark observations before a regression against it means anything.
 * Below this the covariance is noise, so the caller gets null instead.
 */
const MIN_BENCHMARK_OBSERVATIONS = 10

/** Below this, the benchmark variance is floating-point noise rather than signal. */
const MIN_BENCHMARK_VARIANCE = 1e-20

export type BetaAlpha = {
  /** Cov(portfolio, benchmark) / Var(benchmark). */
  beta: number
  /** Annualised, in percentage points. */
  alpha: number
  /** Annualised standard deviation of excess returns, in percentage points. */
  trackingError: number
  /** alpha / trackingError. */
  informationRatio: number
}

/**
 * Beta, alpha, tracking error and information ratio against a benchmark.
 *
 * Both series must be daily returns ALREADY ALIGNED BY DATE: element t of one
 * has to be the same trading day as element t of the other, or the covariance
 * is meaningless. When the lengths differ the most recent overlap is used.
 *
 * Returns null when there is not enough benchmark history. That is deliberate:
 * a caller with no benchmark data should say "not available" rather than fall
 * back to an approximation like vol_portfolio / vol_benchmark, which silently
 * assumes a correlation of 1 and overstates beta for any diversified book.
 *
 * `alpha` is Jensen's alpha: Rp - [Rf + beta*(Rm - Rf)]. Pass riskFreeRate 0 to
 * get the plain excess-return alpha, Rp - beta*Rm, since the two coincide when
 * the risk-free rate is zero.
 *
 * Alpha and tracking error come back in percentage points (12.5 = 12.5%), while
 * riskFreeRate is a fraction (0.0425 = 4.25%), matching the rest of this module.
 */
export function calculateBetaAlpha(
  portfolioReturns: number[],
  benchmarkReturns: number[],
  riskFreeRate: number
): BetaAlpha | null {
  if (benchmarkReturns.length < MIN_BENCHMARK_OBSERVATIONS) return null

  const minLen = Math.min(portfolioReturns.length, benchmarkReturns.length)
  if (minLen < 2) return null

  const pReturns = portfolioReturns.slice(-minLen)
  const bReturns = benchmarkReturns.slice(-minLen)

  const pMean = pReturns.reduce((a, b) => a + b, 0) / minLen
  const bMean = bReturns.reduce((a, b) => a + b, 0) / minLen

  let covariance = 0
  let benchVariance = 0
  for (let i = 0; i < minLen; i++) {
    covariance += (pReturns[i] - pMean) * (bReturns[i] - bMean)
    benchVariance += (bReturns[i] - bMean) ** 2
  }
  covariance /= minLen - 1
  benchVariance /= minLen - 1

  // A flat benchmark carries no information about sensitivity, so 1 is the
  // neutral answer. The threshold is not just > 0: a constant series still
  // leaves ~1e-38 of floating-point dust in the variance, and dividing by that
  // produces a wild beta out of nothing. Any real daily series sits far above
  // this (a 0.01% daily vol is already a variance of 1e-8).
  const beta = benchVariance > MIN_BENCHMARK_VARIANCE ? covariance / benchVariance : 1

  const pAnnual = pMean * TRADING_DAYS * 100
  const bAnnual = bMean * TRADING_DAYS * 100
  const alpha = pAnnual - beta * bAnnual - riskFreeRate * 100 * (1 - beta)

  const excessReturns = pReturns.map((r, i) => r - bReturns[i])
  const exMean = excessReturns.reduce((a, b) => a + b, 0) / minLen
  const exVar = excessReturns.reduce((a, b) => a + (b - exMean) ** 2, 0) / (minLen - 1)
  const trackingError = Math.sqrt(exVar) * Math.sqrt(TRADING_DAYS) * 100

  const informationRatio = trackingError > 0 ? alpha / trackingError : 0

  return { beta, alpha, trackingError, informationRatio }
}
