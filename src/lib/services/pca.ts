// Principal components — pure functions, no I/O.
//
// HHI measures concentration by WEIGHT. It cannot see the thing that most often
// makes a portfolio fragile: ten holdings that all move together are one bet
// repeated ten times, and HHI scores that book as beautifully diversified.
//
// Eigen-decomposing the covariance matrix answers the other question. The
// eigenvalues are the variance of each independent direction the portfolio can
// move in, and how evenly that variance is spread across them is a direct
// measure of how many genuinely separate risks are being taken.
//
// The two belong side by side, and neither replaces the other.

export type Eigen = {
  /** Descending. */
  eigenvalues: number[]
  /** eigenvectors[k] is the unit vector for eigenvalues[k]. */
  eigenvectors: number[][]
}

/** Off-diagonal mass below this counts as diagonal. */
const JACOBI_TOLERANCE = 1e-12
const JACOBI_MAX_SWEEPS = 100

function isUsableSymmetric(matrix: number[][]): boolean {
  const n = matrix.length
  if (n === 0) return false
  if (!matrix.every((row) => row.length === n)) return false
  if (!matrix.every((row) => row.every((v) => Number.isFinite(v)))) return false

  const scale = Math.max(...matrix.map((row) => Math.max(...row.map(Math.abs))), 1)
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (Math.abs(matrix[i][j] - matrix[j][i]) > 1e-9 * scale) return false
    }
  }
  return true
}

/**
 * Jacobi eigenvalue algorithm for a real symmetric matrix.
 *
 * Chosen over the faster general-purpose methods because a covariance matrix is
 * always symmetric, and Jacobi on a symmetric matrix is unconditionally stable
 * and needs no pivoting, no deflation and no special cases for repeated
 * eigenvalues — which is exactly the case that matters here, since N uncorrelated
 * assets of equal volatility produce N identical eigenvalues.
 *
 * Returns null rather than a partial answer for anything that is not a usable
 * symmetric matrix.
 */
export function jacobiEigen(matrix: number[][]): Eigen | null {
  if (!isUsableSymmetric(matrix)) return null

  const n = matrix.length
  // Working copy; the caller's matrix is never touched.
  const a = matrix.map((row) => [...row])
  // Accumulated rotations. Columns of v become the eigenvectors.
  const v: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j): number => (i === j ? 1 : 0)),
  )

  for (let sweep = 0; sweep < JACOBI_MAX_SWEEPS; sweep++) {
    let off = 0
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) off += a[i][j] * a[i][j]
    }
    if (off <= JACOBI_TOLERANCE) break

    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(a[p][q]) <= JACOBI_TOLERANCE) continue

        // Rotation that zeroes a[p][q]. theta is computed via the stable
        // reciprocal form rather than atan, which avoids cancellation when the
        // diagonal entries are close.
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q])
        const t =
          Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1))
        const c = 1 / Math.sqrt(t * t + 1)
        const s = t * c

        for (let k = 0; k < n; k++) {
          const akp = a[k][p]
          const akq = a[k][q]
          a[k][p] = c * akp - s * akq
          a[k][q] = s * akp + c * akq
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p][k]
          const aqk = a[q][k]
          a[p][k] = c * apk - s * aqk
          a[q][k] = s * apk + c * aqk
        }
        for (let k = 0; k < n; k++) {
          const vkp = v[k][p]
          const vkq = v[k][q]
          v[k][p] = c * vkp - s * vkq
          v[k][q] = s * vkp + c * vkq
        }
      }
    }
  }

  const pairs = Array.from({ length: n }, (_, k) => ({
    value: a[k][k],
    vector: v.map((row) => row[k]),
  })).sort((x, y) => y.value - x.value)

  if (pairs.some((p) => !Number.isFinite(p.value))) return null

  return {
    eigenvalues: pairs.map((p) => p.value),
    eigenvectors: pairs.map((p) => p.vector),
  }
}

export type ComponentLoading = { symbol: string; loading: number }

export type PrincipalComponent = {
  index: number
  eigenvalue: number
  varianceExplainedPct: number
  cumulativePct: number
  /** How much each holding contributes to this direction, largest first. */
  loadings: ComponentLoading[]
}

export type PCAResult = {
  components: PrincipalComponent[]
  totalVariance: number
  /** How many components it takes to account for 90% of the variance. */
  componentsFor90Pct: number
  effectiveBets: number
}

/**
 * Decompose a covariance matrix into its independent directions.
 *
 * `componentsFor90Pct` is the headline: ten holdings whose first component
 * already explains 90% of the variance are, for risk purposes, one holding.
 */
export function principalComponents(
  cov: number[][],
  symbols?: string[],
): PCAResult | null {
  const eigen = jacobiEigen(cov)
  if (!eigen) return null

  // Numerical noise can push a near-zero eigenvalue slightly negative; a
  // negative variance is not a thing, so it is floored.
  const values = eigen.eigenvalues.map((v) => Math.max(0, v))
  const total = values.reduce((a, b) => a + b, 0)
  if (!(total > 0)) return null

  const labels = symbols ?? values.map((_, i) => String(i + 1))

  let cumulative = 0
  const components: PrincipalComponent[] = values.map((value, k) => {
    const pct = (value / total) * 100
    cumulative += pct
    return {
      index: k + 1,
      eigenvalue: value,
      varianceExplainedPct: pct,
      cumulativePct: cumulative,
      loadings: eigen.eigenvectors[k]
        .map((loading, i) => ({ symbol: labels[i] ?? String(i + 1), loading }))
        .sort((a, b) => Math.abs(b.loading) - Math.abs(a.loading)),
    }
  })

  const componentsFor90Pct =
    components.findIndex((c) => c.cumulativePct >= 90 - 1e-9) + 1 || components.length

  return {
    components,
    totalVariance: total,
    componentsFor90Pct,
    effectiveBets: entropyBets(values, total),
  }
}

/**
 * The number of genuinely independent bets a book is running.
 *
 * Computed as the exponential of the entropy of the variance shares:
 *
 *   N_eff = exp( -Σ pᵢ · ln pᵢ ),   pᵢ = λᵢ / Σλ
 *
 * The entropy form is used rather than a simple count above a threshold because
 * it has the two properties that make the number interpretable: N equal
 * eigenvalues give exactly N, and one dominant eigenvalue gives exactly 1. Both
 * are asserted in the tests, and everything in between interpolates smoothly.
 */
function entropyBets(values: number[], total: number): number {
  let entropy = 0
  for (const value of values) {
    const p = value / total
    if (p > 0) entropy -= p * Math.log(p)
  }
  return Math.exp(entropy)
}

export function effectiveIndependentBets(cov: number[][]): number | null {
  const eigen = jacobiEigen(cov)
  if (!eigen) return null

  const values = eigen.eigenvalues.map((v) => Math.max(0, v))
  const total = values.reduce((a, b) => a + b, 0)
  if (!(total > 0)) return null

  return entropyBets(values, total)
}

/** Below this ratio of bets to holdings, the diversification is mostly nominal. */
const NOMINAL_DIVERSIFICATION = 0.4

/**
 * The gap between how many things you own and how many bets you are making.
 *
 * Deliberately references HHI, because a reader who has just seen a comfortable
 * HHI needs to be told that this measures something else entirely.
 */
export function describeIndependence(holdings: number, effectiveBets: number): string {
  const bets = effectiveBets.toFixed(1)

  if (holdings <= 1) {
    return `Con una sola posición hay exactamente una fuente de riesgo. El número de apuestas independientes (${bets}) no puede decir más que eso.`
  }

  const ratio = effectiveBets / holdings

  if (ratio < NOMINAL_DIVERSIFICATION) {
    return (
      `Tienes ${holdings} posiciones pero solo ${bets} apuestas realmente independientes: tus activos se ` +
      'mueven en buena parte juntos, así que repartir entre ellos reduce menos riesgo de lo que el número ' +
      'de posiciones sugiere. El HHI mide concentración por PESO y aquí puede salir cómodo; esta cifra mide ' +
      'concentración por COMPORTAMIENTO, y es la que se nota en una caída.'
    )
  }

  if (ratio < 0.7) {
    return (
      `Tus ${holdings} posiciones equivalen a unas ${bets} apuestas independientes. Hay solapamiento entre ` +
      'ellas, pero la diversificación es real. El HHI te dirá si además el peso está bien repartido: son ' +
      'dos preguntas distintas y conviene mirar las dos.'
    )
  }

  return (
    `Tus ${holdings} posiciones equivalen a unas ${bets} apuestas independientes, es decir se mueven de forma ` +
    'bastante distinta entre sí. Eso es diversificación de la que sirve: no solo repartes el dinero, repartes ' +
    'el riesgo. Revisa el HHI aparte para confirmar que el peso también está repartido.'
  )
}
