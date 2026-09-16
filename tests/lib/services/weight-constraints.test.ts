import { describe, it, expect } from 'vitest'
import {
  resolveConstraints,
  projectOntoCappedSimplex,
  projectOntoConstraints,
  satisfiesConstraints,
} from '@/lib/services/weight-constraints'
import { projectOntoSimplex } from '@/lib/services/optimizer'

const resolved = (n: number, c: Parameters<typeof resolveConstraints>[1]) => {
  const r = resolveConstraints(n, c)
  if (!r.ok) throw new Error(`expected feasible, got ${r.reason}`)
  return r.constraints
}

const sum = (v: number[]) => v.reduce((a, b) => a + b, 0)

describe('resolveConstraints', () => {
  it('says nothing binds when nothing was asked for', () => {
    expect(resolved(4, {}).trivial).toBe(true)
  })

  it('refuses constraints that describe no portfolio at all', () => {
    // Five holdings that must each be at least 30% need 150% of the book.
    expect(resolveConstraints(5, { minWeight: 0.3 })).toEqual({ ok: false, reason: 'min-weight-exceeds-one' })
    // Three holdings that may each be at most 20% cannot reach 100%.
    expect(resolveConstraints(3, { maxWeight: 0.2 })).toEqual({ ok: false, reason: 'max-weight-below-one' })
    expect(resolveConstraints(3, { minWeight: 0.5, maxWeight: 0.2 })).toEqual({ ok: false, reason: 'bounds-crossed' })
  })

  it('refuses a sector cap that contradicts the per-asset minimum', () => {
    // Two tech holdings at 10% each is already 20%, and the cap says 15%.
    expect(
      resolveConstraints(3, {
        minWeight: 0.1,
        sectors: ['Tech', 'Tech', 'Energy'],
        sectorCaps: { Tech: 0.15 },
      }),
    ).toEqual({ ok: false, reason: 'sector-cap-below-its-minimums' })
  })

  it('refuses caps that together cannot fund a fully invested book', () => {
    expect(
      resolveConstraints(4, {
        sectors: ['A', 'A', 'B', 'B'],
        sectorCaps: { A: 0.3, B: 0.4 },
      }),
    ).toEqual({ ok: false, reason: 'sector-caps-cannot-reach-one' })
  })

  it('ignores a cap for a sector nothing is in', () => {
    const c = resolved(2, { sectors: ['Tech', 'Tech'], sectorCaps: { Energy: 0.1 } })
    expect(c.groups).toEqual([])
  })
})

describe('projectOntoCappedSimplex', () => {
  it('agrees with the plain simplex projection when the box does not bind', () => {
    const v = [0.9, -0.3, 0.2, 0.4]
    const capped = projectOntoCappedSimplex(v, [0, 0, 0, 0], [1, 1, 1, 1])
    const plain = projectOntoSimplex(v)
    capped.forEach((w, i) => expect(w).toBeCloseTo(plain[i], 9))
  })

  it('never exceeds the maximum, and always sums to one', () => {
    const v = [3, 0.1, 0.1, 0.1]
    const w = projectOntoCappedSimplex(v, [0, 0, 0, 0], [0.4, 0.4, 0.4, 0.4])
    expect(sum(w)).toBeCloseTo(1, 9)
    for (const weight of w) expect(weight).toBeLessThanOrEqual(0.4 + 1e-9)
  })

  it('never falls below the minimum', () => {
    const v = [3, -1, -1, -1]
    const w = projectOntoCappedSimplex(v, [0.15, 0.15, 0.15, 0.15], [1, 1, 1, 1])
    expect(sum(w)).toBeCloseTo(1, 9)
    for (const weight of w) expect(weight).toBeGreaterThanOrEqual(0.15 - 1e-9)
  })

  it('leaves a point that already satisfies everything exactly where it is', () => {
    const feasible = [0.25, 0.25, 0.3, 0.2]
    const w = projectOntoCappedSimplex(feasible, [0, 0, 0, 0], [0.5, 0.5, 0.5, 0.5])
    w.forEach((weight, i) => expect(weight).toBeCloseTo(feasible[i], 9))
  })

  it('is the NEAREST feasible point, not merely a feasible one', () => {
    // Brute force over a grid on the 3-asset simplex with a 50% cap.
    const v = [0.8, 0.15, 0.05]
    const upper = [0.5, 0.5, 0.5]
    const w = projectOntoCappedSimplex(v, [0, 0, 0], upper)
    const distance = (a: number[]) => a.reduce((s, x, i) => s + (x - v[i]) ** 2, 0)

    let best = Infinity
    const STEP = 0.005
    for (let a = 0; a <= 0.5 + 1e-9; a += STEP) {
      for (let b = 0; b <= 0.5 + 1e-9; b += STEP) {
        const c = 1 - a - b
        if (c < -1e-9 || c > 0.5 + 1e-9) continue
        best = Math.min(best, distance([a, b, c]))
      }
    }
    // The grid can only get within its own resolution of the true optimum.
    expect(distance(w)).toBeLessThanOrEqual(best + 1e-4)
  })
})

describe('projectOntoConstraints with sector caps', () => {
  const sectors = ['Tech', 'Tech', 'Energy', 'Health']

  it('pulls an over-concentrated sector back under its cap', () => {
    const constraints = resolved(4, { sectors, sectorCaps: { Tech: 0.4 } })
    const w = projectOntoConstraints([0.6, 0.3, 0.05, 0.05], constraints)
    expect(sum(w)).toBeCloseTo(1, 6)
    expect(w[0] + w[1]).toBeLessThanOrEqual(0.4 + 1e-6)
    expect(satisfiesConstraints(w, constraints)).toBe(true)
  })

  it('honours a box and several caps at once', () => {
    const constraints = resolved(4, {
      minWeight: 0.05,
      maxWeight: 0.35,
      sectors,
      sectorCaps: { Tech: 0.5, Energy: 0.3 },
    })
    const w = projectOntoConstraints([0.7, 0.2, 0.6, -0.5], constraints)
    expect(satisfiesConstraints(w, constraints)).toBe(true)
    expect(sum(w)).toBeCloseTo(1, 6)
  })

  it('leaves a point that already satisfies every constraint alone', () => {
    const constraints = resolved(4, { sectors, sectorCaps: { Tech: 0.5 } })
    const feasible = [0.25, 0.2, 0.3, 0.25]
    const w = projectOntoConstraints(feasible, constraints)
    w.forEach((weight, i) => expect(weight).toBeCloseTo(feasible[i], 6))
  })

  it('produces a valid book from any starting point, including nonsense', () => {
    const constraints = resolved(4, { minWeight: 0.1, maxWeight: 0.4, sectors, sectorCaps: { Tech: 0.6 } })
    for (const start of [[9, -9, 0, 0], [0, 0, 0, 0], [1, 1, 1, 1], [-3, -3, -3, 12]]) {
      const w = projectOntoConstraints(start, constraints)
      expect(satisfiesConstraints(w, constraints)).toBe(true)
      for (const weight of w) expect(Number.isFinite(weight)).toBe(true)
    }
  })

  it('is deterministic', () => {
    const constraints = resolved(4, { maxWeight: 0.4, sectors, sectorCaps: { Tech: 0.5 } })
    const a = projectOntoConstraints([0.7, 0.2, 0.6, -0.5], constraints)
    const b = projectOntoConstraints([0.7, 0.2, 0.6, -0.5], constraints)
    expect(a).toEqual(b)
  })
})
