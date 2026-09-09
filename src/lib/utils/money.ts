// Money arithmetic in integer cents — pure functions, no I/O.
//
// IEEE 754 doubles cannot represent most decimal fractions, so chaining plain
// `+` and `*` over prices and contributions accumulates drift (0.1 + 0.2 !== 0.3).
// Every monetary operation here scales to whole cents, does integer math, and
// scales back, so a P&L built from thousands of trades stays exact to the cent.
// Rounding happens here, at the cent; presentation code must not round again
// beyond formatting.

const CENTS_PER_UNIT = 100

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${label} must be a finite number, received ${value}`)
  }
}

/**
 * Round to the nearest integer, ties away from zero. `Math.round` breaks ties
 * toward +Infinity, which makes -0.5 and 0.5 round to different magnitudes and
 * would leave subtraction asymmetric.
 */
function roundHalfAwayFromZero(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value)
}

/**
 * Integer cents for a monetary amount expressed in major units.
 *
 * The product `amount * 100` carries the binary error of `amount` itself
 * (1.005 * 100 === 100.49999999999999). Re-reading it at 15 significant digits
 * drops that error — it always lives past the 15th digit, while a double holds
 * about 17 — and recovers the decimal value the user actually entered.
 */
export function toCents(amount: number): number {
  assertFinite(amount, 'amount')
  const scaled = Number((amount * CENTS_PER_UNIT).toPrecision(15))
  return roundHalfAwayFromZero(scaled)
}

/** Major units for a whole-cent amount. */
export function fromCents(cents: number): number {
  assertFinite(cents, 'cents')
  return cents / CENTS_PER_UNIT
}

/**
 * Quantise a value that was computed with plain arithmetic — a price delta times
 * a quantity, an FX conversion — down to whole cents. Use this at the boundary
 * where a raw product becomes a monetary amount, rather than quantising the
 * factors first: a $0.0001 price move on 1,000 units is $0.10, but rounding the
 * move to cents beforehand would report $0.00.
 */
export function roundMoney(value: number): number {
  return fromCents(toCents(value))
}

/** Exact sum of two monetary amounts. */
export function addMoney(a: number, b: number): number {
  return fromCents(toCents(a) + toCents(b))
}

/** Exact difference of two monetary amounts. */
export function subtractMoney(a: number, b: number): number {
  return fromCents(toCents(a) - toCents(b))
}

/**
 * A monetary amount scaled by a dimensionless factor — a share quantity, a
 * portfolio weight, a commission rate. The factor is not money, so it is not
 * quantised; only the product is, to the nearest cent.
 */
export function multiplyMoney(amount: number, factor: number): number {
  assertFinite(factor, 'factor')
  const product = Number((toCents(amount) * factor).toPrecision(15))
  return fromCents(roundHalfAwayFromZero(product))
}

/**
 * Split a total across weights so the parts add back up to the total exactly.
 *
 * Rounding each `total * weight` on its own loses or invents cents — three equal
 * thirds of $100 come to $99.99. This uses the largest-remainder method: every
 * part takes its floor in cents, and the cents still unassigned go to the parts
 * with the biggest fractional remainder. Weights are read as proportions and
 * normalised, so they need not already sum to 1.
 */
export function allocateMoney(total: number, weights: number[]): number[] {
  assertFinite(total, 'total')
  if (weights.length === 0) return []

  let weightSum = 0
  for (const weight of weights) {
    assertFinite(weight, 'weight')
    if (weight < 0) {
      throw new RangeError(`weight must not be negative, received ${weight}`)
    }
    weightSum += weight
  }
  if (weightSum === 0) return weights.map(() => 0)

  const sign = total < 0 ? -1 : 1
  const totalCents = Math.abs(toCents(total))
  const exact = weights.map((weight) => (totalCents * weight) / weightSum)
  const parts = exact.map(Math.floor)

  const unassigned = totalCents - parts.reduce((sum, cents) => sum + cents, 0)
  const byRemainder = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index)
  for (let i = 0; i < unassigned && i < byRemainder.length; i++) {
    parts[byRemainder[i].index] += 1
  }

  return parts.map((cents) => fromCents(sign * cents))
}
