import { describe, it, expect } from 'vitest'
import {
  jacobiEigen,
  principalComponents,
  effectiveIndependentBets,
  describeIndependence,
} from '@/lib/services/pca'

/** Covariance for n assets with one shared correlation and one volatility. */
function uniformCov(n: number, vol: number, correlation: number): number[][] {
  return Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? vol * vol : vol * vol * correlation)),
  )
}

describe('jacobiEigen', () => {
  it('diagonalises a diagonal matrix trivially', () => {
    const result = jacobiEigen([
      [4, 0],
      [0, 9],
    ])!
    expect(result.eigenvalues.map((v) => Math.round(v))).toEqual([9, 4])
  })

  it('finds the known eigenvalues of a 2x2', () => {
    // [[2,1],[1,2]] has eigenvalues 3 and 1
    const result = jacobiEigen([
      [2, 1],
      [1, 2],
    ])!
    expect(result.eigenvalues[0]).toBeCloseTo(3, 10)
    expect(result.eigenvalues[1]).toBeCloseTo(1, 10)
  })

  it('returns eigenvalues in descending order', () => {
    const result = jacobiEigen(uniformCov(5, 0.2, 0.4))!
    for (let i = 1; i < result.eigenvalues.length; i++) {
      expect(result.eigenvalues[i]).toBeLessThanOrEqual(result.eigenvalues[i - 1] + 1e-12)
    }
  })

  it('produces eigenvectors of unit length', () => {
    const result = jacobiEigen(uniformCov(4, 0.25, 0.3))!
    for (const vector of result.eigenvectors) {
      const norm = Math.sqrt(vector.reduce((s, v) => s + v * v, 0))
      expect(norm).toBeCloseTo(1, 10)
    }
  })

  it('produces eigenvectors that actually satisfy A v = lambda v', () => {
    // The defining property, checked directly rather than trusted
    const A = uniformCov(3, 0.2, 0.35)
    const { eigenvalues, eigenvectors } = jacobiEigen(A)!

    for (let k = 0; k < 3; k++) {
      const v = eigenvectors[k]
      const Av = A.map((row) => row.reduce((s, a, j) => s + a * v[j], 0))
      for (let i = 0; i < 3; i++) {
        expect(Av[i]).toBeCloseTo(eigenvalues[k] * v[i], 8)
      }
    }
  })

  it('preserves the trace — the eigenvalues sum to the total variance', () => {
    const A = uniformCov(6, 0.18, 0.25)
    const trace = A.reduce((s, row, i) => s + row[i], 0)
    const sum = jacobiEigen(A)!.eigenvalues.reduce((a, b) => a + b, 0)
    expect(sum).toBeCloseTo(trace, 8)
  })

  it('refuses a matrix that is not square or not symmetric', () => {
    expect(jacobiEigen([[1, 2]])).toBeNull()
    expect(
      jacobiEigen([
        [1, 2],
        [3, 4],
      ]),
    ).toBeNull()
  })

  it('refuses a matrix with a non-finite entry', () => {
    expect(
      jacobiEigen([
        [Number.NaN, 0],
        [0, 1],
      ]),
    ).toBeNull()
  })

  it('handles an empty matrix', () => {
    expect(jacobiEigen([])).toBeNull()
  })
})

describe('principalComponents', () => {
  it('splits the variance across components that sum to 100%', () => {
    const result = principalComponents(uniformCov(5, 0.2, 0.3))!
    const total = result.components.reduce((s, c) => s + c.varianceExplainedPct, 0)
    expect(total).toBeCloseTo(100, 8)
  })

  it('reports a running cumulative share', () => {
    const result = principalComponents(uniformCov(5, 0.2, 0.3))!
    const last = result.components[result.components.length - 1]
    expect(last.cumulativePct).toBeCloseTo(100, 8)
    for (let i = 1; i < result.components.length; i++) {
      expect(result.components[i].cumulativePct).toBeGreaterThanOrEqual(
        result.components[i - 1].cumulativePct,
      )
    }
  })

  it('puts almost all the variance in one component when everything moves together', () => {
    const result = principalComponents(uniformCov(8, 0.2, 0.98))!
    expect(result.components[0].varianceExplainedPct).toBeGreaterThan(97)
  })

  it('spreads the variance evenly when nothing is correlated', () => {
    const result = principalComponents(uniformCov(4, 0.2, 0))!
    for (const component of result.components) {
      expect(component.varianceExplainedPct).toBeCloseTo(25, 6)
    }
  })

  it('says how many components it takes to reach 90% of the variance', () => {
    const correlated = principalComponents(uniformCov(10, 0.2, 0.9))!
    const independent = principalComponents(uniformCov(10, 0.2, 0))!
    expect(correlated.componentsFor90Pct).toBeLessThan(independent.componentsFor90Pct)
    expect(correlated.componentsFor90Pct).toBe(1)
  })

  it('carries the loadings so a reader can see what each component is made of', () => {
    // Loadings come back sorted by magnitude, largest contributor first, so the
    // property to assert is that every holding is represented — not that a
    // particular one leads. In a uniform matrix all magnitudes tie anyway.
    const result = principalComponents(uniformCov(3, 0.2, 0.4), ['A', 'B', 'C'])!
    expect(result.components[0].loadings).toHaveLength(3)
    expect(result.components[0].loadings.map((l) => l.symbol).sort()).toEqual(['A', 'B', 'C'])
  })

  it('sorts loadings by magnitude so the dominant holding leads', () => {
    // One asset far more volatile than the rest must lead the first component
    const cov = [
      [0.64, 0.01, 0.01],
      [0.01, 0.01, 0.002],
      [0.01, 0.002, 0.01],
    ]
    const result = principalComponents(cov, ['LOUD', 'quiet1', 'quiet2'])!
    expect(result.components[0].loadings[0].symbol).toBe('LOUD')
  })

  it('labels components by index when no symbols are given', () => {
    const result = principalComponents(uniformCov(2, 0.2, 0.4))!
    expect(result.components[0].loadings[0].symbol).toBe('1')
  })

  it('returns null for a matrix with no variance at all', () => {
    expect(principalComponents([[0, 0], [0, 0]])).toBeNull()
  })
})

describe('effectiveIndependentBets', () => {
  it('is 1 when every asset moves identically', () => {
    // Ten holdings, one bet repeated ten times
    expect(effectiveIndependentBets(uniformCov(10, 0.2, 1))!).toBeCloseTo(1, 4)
  })

  it('is N when N assets are uncorrelated and equally volatile', () => {
    expect(effectiveIndependentBets(uniformCov(6, 0.2, 0))!).toBeCloseTo(6, 6)
    expect(effectiveIndependentBets(uniformCov(3, 0.35, 0))!).toBeCloseTo(3, 6)
  })

  it('falls between 1 and N for anything in between', () => {
    const value = effectiveIndependentBets(uniformCov(10, 0.2, 0.5))!
    expect(value).toBeGreaterThan(1)
    expect(value).toBeLessThan(10)
  })

  it('falls as correlation rises', () => {
    let previous = Number.POSITIVE_INFINITY
    for (const correlation of [0, 0.2, 0.5, 0.8, 0.95]) {
      const value = effectiveIndependentBets(uniformCov(8, 0.2, correlation))!
      expect(value).toBeLessThan(previous)
      previous = value
    }
  })

  it('is never larger than the number of holdings', () => {
    for (const n of [2, 5, 12]) {
      expect(effectiveIndependentBets(uniformCov(n, 0.2, 0.1))!).toBeLessThanOrEqual(n + 1e-9)
    }
  })

  it('returns null when there is no variance to decompose', () => {
    expect(effectiveIndependentBets([[0, 0], [0, 0]])).toBeNull()
  })
})

describe('describeIndependence', () => {
  it('contrasts the holding count against the real number of bets', () => {
    const text = describeIndependence(10, 1.4)
    expect(text).toMatch(/10/)
    expect(text).toMatch(/1\.4/)
    expect(text.length).toBeGreaterThan(60)
  })

  it('reads a well-spread book differently from a concentrated one', () => {
    expect(describeIndependence(10, 1.2)).not.toBe(describeIndependence(10, 8.5))
  })

  it('says HHI and this measure answer different questions', () => {
    expect(describeIndependence(10, 1.2).toLowerCase()).toMatch(/peso|hhi/)
  })

  it('handles a single holding', () => {
    expect(describeIndependence(1, 1).length).toBeGreaterThan(20)
  })
})
