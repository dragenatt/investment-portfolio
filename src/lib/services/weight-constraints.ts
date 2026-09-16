// Projecting a weight vector onto the set of portfolios a reader would accept.
//
// The optimiser was long-only and fully invested and nothing else: it projected
// each iterate onto the probability simplex, which guarantees Σw = 1 and w ≥ 0
// and permits everything in between — including the whole book in one holding.
// P1-31 and P1-32 both list minimum weight, maximum weight and sector caps as
// required inputs, and neither had them.
//
// Three families of constraint, all convex:
//
//   the simplex      Σwᵢ = 1
//   the box          lᵢ ≤ wᵢ ≤ uᵢ
//   a group cap      Σ_{i∈S} wᵢ ≤ c_S     (one per sector)
//
// The box intersected with the simplex — the "capped simplex" — has an exact
// projection: clamp(vᵢ − λ) for the λ that makes the clamped weights sum to 1,
// found by bisection because the sum is monotone in λ. A single group cap is a
// halfspace, also exact. Their intersection has no closed form, so Dykstra's
// algorithm is used: alternate the exact projections while carrying a correction
// term per set, which is what makes it converge to the projection onto the
// intersection rather than merely to some point inside it.
//
// Everything here is deterministic. Same input, same weights, every time.

/** What the caller may ask for. All optional; absent means unconstrained. */
export type WeightConstraints = {
  /** Smallest share any holding may take. Default 0 (long-only). */
  minWeight?: number
  /** Largest share any holding may take. Default 1. */
  maxWeight?: number
  /** Sector label per asset, aligned with the weight vector. */
  sectors?: Array<string | null | undefined>
  /** Largest share a sector may take, keyed by the labels in `sectors`. */
  sectorCaps?: Record<string, number>
}

export type GroupCap = { indices: number[]; cap: number }

/** The constraints resolved to per-asset bounds and group caps. */
export type ResolvedConstraints = {
  lower: number[]
  upper: number[]
  groups: GroupCap[]
  /** True when no constraint actually binds, so the plain simplex projection will do. */
  trivial: boolean
}

/** Why a set of constraints describes no portfolio at all. */
export type InfeasibleReason =
  | 'min-weight-exceeds-one'
  | 'max-weight-below-one'
  | 'bounds-crossed'
  | 'sector-cap-below-its-minimums'
  | 'sector-caps-cannot-reach-one'

export type Resolution =
  | { ok: true; constraints: ResolvedConstraints }
  | { ok: false; reason: InfeasibleReason }

const TOLERANCE = 1e-9

/**
 * Turn the caller's constraints into bounds and groups, or say why they cannot
 * be met.
 *
 * Infeasibility is reported rather than silently relaxed. A book that cannot
 * exist should not come back as a book that violates what was asked for — that
 * is the failure mode the roadmap's rule 8 exists to prevent.
 */
export function resolveConstraints(n: number, constraints: WeightConstraints = {}): Resolution {
  const min = Number.isFinite(constraints.minWeight) ? Math.max(0, constraints.minWeight!) : 0
  const max = Number.isFinite(constraints.maxWeight) ? Math.min(1, constraints.maxWeight!) : 1

  if (n === 0) return { ok: true, constraints: { lower: [], upper: [], groups: [], trivial: true } }
  if (min > max + TOLERANCE) return { ok: false, reason: 'bounds-crossed' }
  if (min * n > 1 + TOLERANCE) return { ok: false, reason: 'min-weight-exceeds-one' }
  if (max * n < 1 - TOLERANCE) return { ok: false, reason: 'max-weight-below-one' }

  const lower = Array(n).fill(min)
  const upper = Array(n).fill(max)

  const groups: GroupCap[] = []
  /** Every capped sector, singletons included — the feasibility sum needs them all. */
  const allCapped: GroupCap[] = []
  const caps = constraints.sectorCaps ?? {}
  const sectors = constraints.sectors ?? []
  const capped = Object.keys(caps).filter((label) => Number.isFinite(caps[label]))

  for (const label of capped) {
    const indices: number[] = []
    for (let i = 0; i < n; i++) if (sectors[i] === label) indices.push(i)
    if (indices.length === 0) continue

    const cap = Math.max(0, Math.min(1, caps[label]))
    // A cap below what the per-asset minimums already force is a contradiction.
    if (cap < min * indices.length - TOLERANCE) return { ok: false, reason: 'sector-cap-below-its-minimums' }

    // No holding can exceed its own sector's cap, so the cap tightens each
    // member's upper bound. This is not merely an optimisation: folding it in
    // turns a single-holding sector cap into a plain bound, which the capped
    // simplex enforces exactly, and it lets the alternating projection start
    // far closer to the answer. Without it the iteration crawled — a sector of
    // one sat at its box maximum, above its own cap, for hundreds of cycles.
    for (const i of indices) upper[i] = Math.min(upper[i], cap)

    allCapped.push({ indices, cap })
    // A sector of one is now fully described by that bound; keeping it as a
    // group as well would only slow the projection down.
    if (indices.length > 1) groups.push({ indices, cap })
  }

  // The most a feasible book can add up to: each capped sector contributes the
  // lesser of its cap and what its own bounds allow, and everything outside any
  // cap contributes its upper bound. Below 1 there is no fully invested book —
  // and per-asset bounds alone cannot see this, because two sectors capped at
  // 30% and 40% leave four holdings whose individual bounds sum to 1.4.
  const inACappedSector = new Set(allCapped.flatMap((g) => g.indices))
  let reachable = 0
  for (const group of allCapped) {
    reachable += Math.min(group.cap, group.indices.reduce((sum, i) => sum + upper[i], 0))
  }
  for (let i = 0; i < n; i++) if (!inACappedSector.has(i)) reachable += upper[i]
  if (reachable < 1 - TOLERANCE) {
    return { ok: false, reason: capped.length > 0 ? 'sector-caps-cannot-reach-one' : 'max-weight-below-one' }
  }

  const trivial = min === 0 && max === 1 && groups.length === 0 && upper.every((u) => u === 1)
  return { ok: true, constraints: { lower, upper, groups, trivial } }
}

/**
 * Exact projection onto { w : Σw = 1, lᵢ ≤ wᵢ ≤ uᵢ }.
 *
 * clamp(vᵢ − λ, lᵢ, uᵢ) summed over i is continuous and non-increasing in λ, so
 * the λ that makes it 1 is found by bisection. The bracket is wide enough that
 * the sum is above 1 at the low end and below it at the high end for any finite
 * input.
 */
export function projectOntoCappedSimplex(v: number[], lower: number[], upper: number[]): number[] {
  const n = v.length
  if (n === 0) return []
  if (!v.every(Number.isFinite)) return lower.map((l, i) => l + (1 - lower.reduce((a, b) => a + b, 0)) * (upper[i] - l) / Math.max(TOLERANCE, upper.reduce((a, b) => a + b, 0) - lower.reduce((a, b) => a + b, 0)))

  const clampedSum = (lambda: number): number => {
    let sum = 0
    for (let i = 0; i < n; i++) sum += Math.min(upper[i], Math.max(lower[i], v[i] - lambda))
    return sum
  }

  const spread = Math.max(...v.map(Math.abs), 1) + 2
  let low = -spread
  let high = spread
  // Widen until the bracket really straddles 1, which it does for any finite v.
  for (let guard = 0; guard < 60 && clampedSum(low) < 1; guard++) low -= spread
  for (let guard = 0; guard < 60 && clampedSum(high) > 1; guard++) high += spread

  for (let i = 0; i < 100; i++) {
    const mid = (low + high) / 2
    if (clampedSum(mid) > 1) low = mid
    else high = mid
  }

  const lambda = (low + high) / 2
  return v.map((value, i) => Math.min(upper[i], Math.max(lower[i], value - lambda)))
}

/** Exact projection onto the halfspace { w : Σ_{i∈S} wᵢ ≤ cap }. */
function projectOntoGroupCap(v: number[], group: GroupCap): number[] {
  let sum = 0
  for (const i of group.indices) sum += v[i]
  if (sum <= group.cap + TOLERANCE) return v

  const shift = (sum - group.cap) / group.indices.length
  const out = v.slice()
  for (const i of group.indices) out[i] -= shift
  return out
}

/** Dykstra cycles; more than enough for a handful of sets at this size. */
const DYKSTRA_ITERATIONS = 400
const DYKSTRA_TOLERANCE = 1e-12

/**
 * Projection onto the intersection of the capped simplex and every sector cap.
 *
 * Dykstra rather than plain alternating projections: alternating alone converges
 * to *a* point of the intersection, not to the nearest one, and the optimiser
 * needs the nearest one for its convergence argument to hold.
 */
export function projectOntoConstraints(v: number[], constraints: ResolvedConstraints): number[] {
  const { lower, upper, groups } = constraints
  if (groups.length === 0) return projectOntoCappedSimplex(v, lower, upper)

  // The capped simplex goes LAST in the cycle, so the vector that comes out of
  // every cycle sums to exactly 1. Ending on a group cap instead left the sum a
  // hair short, and "fixing" that afterwards with one more capped-simplex
  // projection pushed every weight up by a common amount — which put a capped
  // sector straight back over its cap. Σw = 1 is the constraint that must hold
  // exactly; the caps are inequalities that Dykstra tightens to convergence.
  const projections: Array<(w: number[]) => number[]> = [
    ...groups.map((group) => (w: number[]) => projectOntoGroupCap(w, group)),
    (w: number[]) => projectOntoCappedSimplex(w, lower, upper),
  ]
  const corrections: number[][] = projections.map(() => new Array<number>(v.length).fill(0))
  let x = v.slice()

  for (let cycle = 0; cycle < DYKSTRA_ITERATIONS; cycle++) {
    const before = x
    for (let k = 0; k < projections.length; k++) {
      const y = x.map((value, i) => value + corrections[k][i])
      const projected = projections[k](y)
      corrections[k] = y.map((value, i) => value - projected[i])
      x = projected
    }
    // Stopping on "the vector stopped moving" alone is wrong: Dykstra parks x
    // for several cycles while the correction terms build up, and cutting out
    // there returns a point that satisfies the box and the sum but not the
    // caps. The iterate has to be feasible before stillness means convergence.
    let movement = 0
    for (let i = 0; i < x.length; i++) movement += Math.abs(x[i] - before[i])
    if (movement < DYKSTRA_TOLERANCE && satisfiesConstraints(x, constraints)) break
  }

  return x
}

/** Whether a weight vector actually satisfies everything asked of it. */
export function satisfiesConstraints(
  weights: number[],
  constraints: ResolvedConstraints,
  tolerance = 1e-6,
): boolean {
  const sum = weights.reduce((a, b) => a + b, 0)
  if (Math.abs(sum - 1) > tolerance) return false
  for (let i = 0; i < weights.length; i++) {
    if (weights[i] < constraints.lower[i] - tolerance) return false
    if (weights[i] > constraints.upper[i] + tolerance) return false
  }
  for (const group of constraints.groups) {
    let groupSum = 0
    for (const i of group.indices) groupSum += weights[i]
    if (groupSum > group.cap + tolerance) return false
  }
  return true
}
