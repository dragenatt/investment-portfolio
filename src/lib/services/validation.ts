// Financial output validation — pure functions, no I/O.
//
// Roadmap rule #8: no invalid result may reach the interface. NaN, Infinity, a
// probability above 1, weights that do not sum to 100%, a volatility no market
// could produce. These do not throw when they are created — they propagate
// quietly through arithmetic and surface as "NaN%" on a dashboard, or worse, as
// a plausible-looking wrong number.
//
// The recursive scanners here are the last line: they run over the whole
// response payload at the API boundary, where every endpoint has to pass. The
// individual validators are for the engines, which should catch their own
// problems long before that.

export type ValidationResult = { valid: boolean; reason?: string }

const ok: ValidationResult = { valid: true }
const fail = (reason: string): ValidationResult => ({ valid: false, reason })

// ─── Payload scanning ───────────────────────────────────────────────────────

function isInvalidNumber(value: unknown): boolean {
  return typeof value === 'number' && !Number.isFinite(value)
}

/**
 * Paths of every non-finite number in a payload, in dotted/indexed form
 * (`current.sharpe_ratio`, `series[3]`).
 *
 * Null is not invalid: it is how this codebase says "cannot be computed", which
 * is the honest answer. Only a number that claims to be a number and is not
 * counts.
 */
export function findInvalidNumbers(payload: unknown): string[] {
  const found: string[] = []
  const seen = new WeakSet<object>()

  const walk = (value: unknown, path: string) => {
    if (isInvalidNumber(value)) {
      found.push(path || '<root>')
      return
    }
    if (value === null || typeof value !== 'object') return

    // A payload that references itself would otherwise loop forever.
    if (seen.has(value)) return
    seen.add(value)

    if (Array.isArray(value)) {
      value.forEach((item, i) => walk(item, `${path}[${i}]`))
      return
    }
    for (const [key, item] of Object.entries(value)) {
      walk(item, path ? `${path}.${key}` : key)
    }
  }

  walk(payload, '')
  return found
}

/**
 * A copy of the payload with every non-finite number replaced by null, plus the
 * paths that were replaced.
 *
 * Null is the right substitute: the interface already renders it as "--", so an
 * unusable number degrades to an honest gap instead of "NaN%". The input is left
 * untouched — a caller may still want the raw value for logging.
 */
export function sanitizeFinancialPayload<T>(payload: T): { payload: T; replaced: string[] } {
  const replaced = findInvalidNumbers(payload)
  if (replaced.length === 0) return { payload, replaced }

  const seen = new WeakMap<object, unknown>()

  const clean = (value: unknown): unknown => {
    if (isInvalidNumber(value)) return null
    if (value === null || typeof value !== 'object') return value
    if (seen.has(value)) return seen.get(value)

    if (Array.isArray(value)) {
      const copy: unknown[] = []
      seen.set(value, copy)
      for (const item of value) copy.push(clean(item))
      return copy
    }

    const copy: Record<string, unknown> = {}
    seen.set(value, copy)
    for (const [key, item] of Object.entries(value)) copy[key] = clean(item)
    return copy
  }

  return { payload: clean(payload) as T, replaced }
}

// ─── Individual quantities ──────────────────────────────────────────────────

/** Weights may miss 100% by this much before it counts as a bug rather than rounding. */
const WEIGHT_TOLERANCE = 1e-3

export function validateWeights(
  weights: number[],
  options: { allowNegative?: boolean; tolerance?: number } = {},
): ValidationResult {
  if (weights.length === 0) return fail('No weights were provided.')
  if (!weights.every((w) => Number.isFinite(w))) return fail('A weight is not a finite number.')

  if (!options.allowNegative) {
    const negative = weights.findIndex((w) => w < 0)
    if (negative >= 0) {
      return fail(`Weight at position ${negative} is negative, which requires a short position.`)
    }
  }

  const total = weights.reduce((a, b) => a + b, 0)
  const tolerance = options.tolerance ?? WEIGHT_TOLERANCE
  if (Math.abs(total - 1) > tolerance) {
    return fail(`Weights sum to ${(total * 100).toFixed(2)}% instead of 100%.`)
  }
  return ok
}

export function validateProbability(
  value: number,
  options: { scale?: 'fraction' | 'percent' } = {},
): ValidationResult {
  if (!Number.isFinite(value)) return fail('Probability is not a finite number.')
  const max = options.scale === 'percent' ? 100 : 1
  if (value < 0 || value > max) {
    return fail(`Probability ${value} lies outside 0-${max}.`)
  }
  return ok
}

/** Past this, an annual volatility is a unit error rather than a market. */
const MAX_ANNUAL_VOLATILITY = 5

export function validateVolatility(value: number): ValidationResult {
  if (!Number.isFinite(value)) return fail('Volatility is not a finite number.')
  if (value < 0) return fail('Volatility is negative, which has no meaning.')
  if (value > MAX_ANNUAL_VOLATILITY) {
    return fail(`Annual volatility of ${value} is implausible; check the units.`)
  }
  return ok
}

export function validateReturnPct(value: number): ValidationResult {
  if (!Number.isFinite(value)) return fail('Return is not a finite number.')
  // A long, unlevered position bottoms out at a total loss.
  if (value < -100) return fail(`A return of ${value}% is below a total loss.`)
  return ok
}

export function validateCovarianceMatrix(matrix: number[][]): ValidationResult {
  const n = matrix.length
  if (n === 0) return fail('Covariance matrix is empty.')
  if (!matrix.every((row) => row.length === n)) return fail('Covariance matrix is not square.')
  if (!matrix.every((row) => row.every((v) => Number.isFinite(v)))) {
    return fail('Covariance matrix contains a non-finite entry.')
  }

  for (let i = 0; i < n; i++) {
    if (matrix[i][i] < 0) return fail(`Variance at position ${i} is negative.`)
  }

  const scale = Math.max(...matrix.map((row) => Math.max(...row.map(Math.abs))), 1)
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (Math.abs(matrix[i][j] - matrix[j][i]) > 1e-9 * scale) {
        return fail(`Covariance matrix is not symmetric at (${i}, ${j}).`)
      }
      // Cauchy-Schwarz: |cov| cannot exceed the product of the two deviations,
      // which is the same as saying no pair may imply a correlation above 1.
      const bound = Math.sqrt(matrix[i][i] * matrix[j][j])
      if (Math.abs(matrix[i][j]) > bound * (1 + 1e-9)) {
        return fail(`Covariance at (${i}, ${j}) implies a correlation above 1.`)
      }
    }
  }

  return ok
}
