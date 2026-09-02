// Covariance and Cholesky primitives — pure functions, no I/O, fully unit-testable.
//
// These are the two pieces the Monte Carlo engine needs to make several assets
// move *together* the way they historically did. calculateCovarianceMatrix
// summarises how each pair of assets co-moves; choleskyDecomposition factors
// that matrix into L with L·Lᵀ = Σ, which is what turns a vector of independent
// standard normals ε into a vector of correlated shocks z = L·ε.

/**
 * Sample covariance matrix of n daily-return series.
 *
 * `returnsMatrix` holds one series per asset, already aligned by date (element
 * t of every series must be the same trading day). Uses the n-1 denominator, so
 * the diagonal matches the variance implied by calculateVolatility in
 * analytics.ts (before its √252 annualisation).
 *
 * Returns an n×n symmetric matrix, or a zero matrix when there are fewer than
 * two observations to work with. Never throws.
 */
export function calculateCovarianceMatrix(returnsMatrix: number[][]): number[][] {
  const n = returnsMatrix.length
  if (n === 0) return []

  const zeros = () => Array.from({ length: n }, () => new Array<number>(n).fill(0))

  // Series should arrive aligned; if a caller hands over ragged ones, fall back
  // to the most recent overlapping window (same idiom as the risk route's
  // slice(-minLen)) rather than reading past the end of the short series.
  const observations = Math.min(...returnsMatrix.map((series) => series.length))
  if (observations < 2) return zeros()

  const series = returnsMatrix.map((s) => s.slice(-observations))
  const means = series.map((s) => s.reduce((a, b) => a + b, 0) / observations)

  const cov = zeros()
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      let sum = 0
      for (let t = 0; t < observations; t++) {
        sum += (series[i][t] - means[i]) * (series[j][t] - means[j])
      }
      const c = sum / (observations - 1)
      cov[i][j] = c
      cov[j][i] = c // symmetric by construction
    }
  }
  return cov
}

// Pivots below this are treated as exactly zero rather than as a tiny positive
// number, whose square root would blow up the rest of the column.
const PIVOT_EPSILON = 1e-12

/**
 * Cholesky decomposition: returns the lower-triangular L such that L·Lᵀ = Σ.
 *
 * Accepts positive *semi*-definite input, not just positive definite. That
 * matters here: a correlation of exactly ±1 between two assets makes Σ singular,
 * and the pivot lands on zero (or a hair below it after floating-point drift).
 * Those columns are zeroed instead of producing NaN, and L·Lᵀ still reconstructs
 * Σ — which is what makes the perfectly-correlated case simulate correctly.
 *
 * Throws only on a malformed (non-square) matrix, which is a programmer error.
 */
export function choleskyDecomposition(covMatrix: number[][]): number[][] {
  const n = covMatrix.length
  if (n === 0) return []
  if (covMatrix.some((row) => row.length !== n)) {
    throw new Error('choleskyDecomposition: matrix must be square')
  }

  const L = Array.from({ length: n }, () => new Array<number>(n).fill(0))

  for (let j = 0; j < n; j++) {
    let pivot = covMatrix[j][j]
    for (let k = 0; k < j; k++) pivot -= L[j][k] * L[j][k]

    if (pivot <= PIVOT_EPSILON) {
      // Degenerate column: this asset adds no independent source of randomness.
      for (let i = j; i < n; i++) L[i][j] = 0
      continue
    }

    L[j][j] = Math.sqrt(pivot)
    for (let i = j + 1; i < n; i++) {
      let sum = covMatrix[i][j]
      for (let k = 0; k < j; k++) sum -= L[i][k] * L[j][k]
      L[i][j] = sum / L[j][j]
    }
  }

  return L
}
