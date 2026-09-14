// Share and unit quantities — pure functions, no I/O.
//
// money.ts keeps amounts in integer cents. Quantities had no equivalent: they
// were added and subtracted as raw doubles, and a position's quantity is the
// running sum of every buy and sell ever made on it. Two things came of that.
//
// Binary drift: 39.401103 + 39.4011 - 75.8022 - 3 is 0.000002999999992425728
// in floating point, not 0.000003.
//
// And, more importantly, dust. The trade modal stores quantities to six
// decimals and the positions table displays four, so a user who sells "all"
// the 78.8022 shares they can see leaves 0.000003 behind — a real remainder, not
// a rounding error, that exact arithmetic would preserve just as faithfully.
// Worth $0.0001, it was counted as a holding by every analytic in the app.
//
// So quantities are quantised to a fixed number of decimals, the same way
// money.ts quantises cents, and a sale that leaves a remainder worth less than
// the smallest amount of money the app represents closes the position.

/**
 * Decimal places a quantity is kept to.
 *
 * Eight covers the six the trade modal writes and a satoshi (1e-8 BTC). Below
 * about 90 million units the arithmetic is exact at this precision; above that
 * a double cannot hold 8 decimals anyway, and results are exact to the 15
 * significant digits the input itself carried.
 */
export const QUANTITY_DECIMALS = 8
const SCALE = 10 ** QUANTITY_DECIMALS

/**
 * Below this, a position's value rounds to $0.00 at cent precision — money.ts
 * cannot represent it — so the remainder is dust. Half a cent is the rounding
 * boundary, not a chosen tolerance.
 *
 * Judged by value rather than by share count on purpose: 0.00004 BTC is $3.60,
 * while 0.000003 RBLX is $0.0001. No single share epsilon is right for both.
 */
export const DUST_VALUE = 0.005

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${label} must be a finite number, received ${value}`)
  }
}

/** Integer units of 1e-8. Re-read at 15 significant digits to shed binary error, as toCents does. */
function toUnits(quantity: number): number {
  assertFinite(quantity, 'quantity')
  const scaled = Number((quantity * SCALE).toPrecision(15))
  return scaled < 0 ? -Math.round(-scaled) : Math.round(scaled)
}

function fromUnits(units: number): number {
  return units / SCALE
}

/** A quantity rounded to QUANTITY_DECIMALS. */
export function roundQuantity(quantity: number): number {
  return fromUnits(toUnits(quantity))
}

export function addQuantity(a: number, b: number): number {
  return fromUnits(toUnits(a) + toUnits(b))
}

export function subtractQuantity(a: number, b: number): number {
  return fromUnits(toUnits(a) - toUnits(b))
}

/** A quantity scaled by a dimensionless factor, such as a split ratio. */
export function multiplyQuantity(quantity: number, factor: number): number {
  assertFinite(factor, 'factor')
  return roundQuantity(Number((quantity * factor).toPrecision(15)))
}

/**
 * Whether a quantity left over after a sale is worth less than half a cent at
 * the price it was sold at.
 *
 * False for zero (nothing is left), and false when the price is unusable: with
 * no way to value the remainder, closing the position would be a guess.
 */
export function isDustRemainder(quantity: number, price: number): boolean {
  if (!Number.isFinite(quantity) || !(quantity > 0)) return false
  if (!Number.isFinite(price) || !(Math.abs(price) > 0)) return false
  return quantity * Math.abs(price) < DUST_VALUE
}
