// Risk attribution — pure functions, no I/O.
//
// Weight answers "how much of my money is here". It does not answer "how much
// of my risk is here", and the two come apart badly: 10% of a book held in
// something three times as volatile as the rest carries far more than 10% of
// the risk, and a reader looking at a pie chart of weights will never see it.
//
// The decomposition used here is the standard Euler one. Portfolio volatility
// is homogeneous of degree one in the weights, so the per-asset contributions
// sum exactly to it — which is what makes this an attribution rather than a set
// of loosely related numbers, and is asserted directly in the tests.
//
//   marginal contribution   MCR_i = (Σw)_i / σ_p
//   contribution            CTR_i = w_i · MCR_i,   Σ CTR_i = σ_p
//
// See docs/FINANCIAL_ASSUMPTIONS.md.

export type RiskContribution = {
  symbol: string
  weight: number
  /** Standalone volatility of the asset itself. */
  volatility: number
  /** How much portfolio volatility moves per unit of extra weight here. */
  marginalContribution: number
  /** This asset's share of portfolio volatility, in volatility units. */
  contribution: number
  /** The same share as a percentage. These sum to 100. */
  percentOfRisk: number
}

export type RiskAttribution = {
  portfolioVolatility: number
  /** Weighted sum of standalone volatilities: the risk with no diversification at all. */
  undiversifiedVolatility: number
  /** How much volatility diversification actually removed. */
  diversificationBenefit: number
  diversificationRatio: number
  /** Largest share of risk first. */
  contributions: RiskContribution[]
}

function isSquare(matrix: number[][], n: number): boolean {
  return matrix.length === n && matrix.every((row) => row.length === n)
}

function allFinite(matrix: number[][]): boolean {
  return matrix.every((row) => row.every((v) => Number.isFinite(v)))
}

/** Σw, the vector of covariances between each asset and the portfolio. */
function covarianceWithPortfolio(weights: number[], cov: number[][]): number[] {
  return cov.map((row) => row.reduce((sum, value, j) => sum + value * weights[j], 0))
}

/**
 * Portfolio volatility, sqrt(wᵀΣw).
 *
 * Returns null rather than NaN when the inputs do not line up or the quadratic
 * form comes out negative, which a numerically damaged covariance matrix can
 * produce and which has no square root worth showing anyone.
 */
export function portfolioVolatility(weights: number[], cov: number[][]): number | null {
  const n = weights.length
  if (n === 0 || !isSquare(cov, n) || !allFinite(cov)) return null
  if (!weights.every((w) => Number.isFinite(w))) return null

  const variance = covarianceWithPortfolio(weights, cov).reduce(
    (sum, value, i) => sum + weights[i] * value,
    0,
  )
  if (!Number.isFinite(variance) || variance < 0) return null
  return Math.sqrt(variance)
}

/** The weighted average of standalone volatilities — the risk if nothing diversified. */
function undiversifiedVolatility(weights: number[], cov: number[][]): number {
  return weights.reduce((sum, w, i) => sum + Math.abs(w) * Math.sqrt(Math.max(0, cov[i][i])), 0)
}

/**
 * Split portfolio volatility across the holdings that produce it.
 *
 * Returns null when the book has no measurable risk — every contribution would
 * be a division by zero, and "0% of nothing" is not a useful answer.
 */
export function riskContributions(
  symbols: string[],
  weights: number[],
  cov: number[][],
): RiskAttribution | null {
  const n = symbols.length
  if (n === 0 || weights.length !== n) return null

  const sigma = portfolioVolatility(weights, cov)
  if (sigma === null || sigma <= 0) return null

  const sigmaW = covarianceWithPortfolio(weights, cov)
  const contributions: RiskContribution[] = symbols.map((symbol, i) => {
    const marginalContribution = sigmaW[i] / sigma
    const contribution = weights[i] * marginalContribution
    return {
      symbol,
      weight: weights[i],
      volatility: Math.sqrt(Math.max(0, cov[i][i])),
      marginalContribution,
      contribution,
      percentOfRisk: (contribution / sigma) * 100,
    }
  })

  contributions.sort((a, b) => b.percentOfRisk - a.percentOfRisk)

  const standalone = undiversifiedVolatility(weights, cov)
  return {
    portfolioVolatility: sigma,
    undiversifiedVolatility: standalone,
    diversificationBenefit: standalone - sigma,
    diversificationRatio: standalone / sigma,
    contributions,
  }
}

/**
 * Weighted average standalone volatility over portfolio volatility.
 *
 * 1 means diversification bought nothing — everything moves together. Higher is
 * better, and the ceiling for N equally weighted, uncorrelated assets is √N.
 */
export function diversificationRatio(weights: number[], cov: number[][]): number | null {
  const sigma = portfolioVolatility(weights, cov)
  if (sigma === null || sigma <= 0) return null
  return undiversifiedVolatility(weights, cov) / sigma
}

/** Above this, a handful of holdings is carrying the book's risk. */
const CONCENTRATION_THRESHOLD_PCT = 50

/**
 * Say where the risk actually sits, in a sentence.
 *
 * Deliberately compares against weight, because the interesting case is not
 * "this is a big position" — the reader can see that — but "this position is
 * carrying more risk than its size suggests".
 */
export function describeRiskConcentration(contributions: RiskContribution[]): string {
  if (contributions.length === 0) {
    return 'There are no holdings to attribute risk to.'
  }

  const ranked = [...contributions].sort((a, b) => b.percentOfRisk - a.percentOfRisk)
  const topTwo = ranked.slice(0, 2)
  const topTwoShare = topTwo.reduce((sum, c) => sum + c.percentOfRisk, 0)

  if (topTwoShare < CONCENTRATION_THRESHOLD_PCT) {
    return (
      `Risk is spread fairly evenly: no single holding drives it, and the two largest ` +
      `contributors together account for ${topTwoShare.toFixed(0)}% of portfolio volatility.`
    )
  }

  const names = topTwo.map((c) => c.symbol).join(' and ')
  const weightShare = topTwo.reduce((sum, c) => sum + c.weight, 0) * 100
  const outsized = topTwoShare > weightShare + 5

  const base = `${topTwoShare.toFixed(0)}% of your portfolio's risk comes from ${names}.`
  return outsized
    ? `${base} They are only ${weightShare.toFixed(0)}% of the money, so they carry more risk than their size suggests.`
    : `${base} That is roughly in line with their ${weightShare.toFixed(0)}% of the money.`
}
