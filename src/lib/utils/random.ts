// Seeded randomness — one implementation, shared.
//
// Until the lab needed random draws too, this lived twice: a private copy in
// advisor.ts and another in monte-carlo.ts. The generator was identical in both.
// The normal samplers were NOT — one throws away the second value of each
// Box-Muller pair, the other keeps it — and that difference changes which
// shocks every seeded projection gets. Both are kept here exactly as they were,
// so extracting them moved code without moving a single number.

/** mulberry32 — small, fast, seedable, and deterministic across platforms. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * One standard normal per call, via Box-Muller, discarding the second value of
 * the pair. u1 is clamped off zero so log never sees it.
 *
 * The advisor's scenario set is built on this one.
 */
export function standardNormal(random: () => number): number {
  const u1 = Math.max(random(), Number.MIN_VALUE)
  const u2 = random()
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
}

/**
 * A stream of standard normals that uses BOTH halves of each Box-Muller pair.
 *
 * The portfolio Monte Carlo is built on this one. Half the generator calls of
 * standardNormal for the same number of draws.
 */
export function createNormalSampler(seed: number): () => number {
  const rng = mulberry32(seed)
  let spare: number | null = null
  return () => {
    if (spare !== null) {
      const value = spare
      spare = null
      return value
    }
    let u = 0
    while (u === 0) u = rng() // log(0) would be -Infinity
    const v = rng()
    const radius = Math.sqrt(-2 * Math.log(u))
    const theta = 2 * Math.PI * v
    spare = radius * Math.sin(theta)
    return radius * Math.cos(theta)
  }
}
