import { describe, it, expect } from 'vitest'
import { calculateCovarianceMatrix, choleskyDecomposition } from '@/lib/services/covariance'

/** Σ ≈ L·Lᵀ, entry by entry. */
function expectReconstructs(L: number[][], sigma: number[][], tolerance = 1e-9) {
  const n = sigma.length
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      let sum = 0
      for (let k = 0; k < n; k++) sum += L[i][k] * L[j][k]
      expect(Math.abs(sum - sigma[i][j])).toBeLessThan(tolerance)
    }
  }
}

describe('calculateCovarianceMatrix', () => {
  it('matches the hand-computed sample covariance', () => {
    // A = [1,2,3,4] -> deviations [-1.5,-0.5,0.5,1.5], Σd² = 5, /(4-1) = 1.6667
    // B = 2A, so cov(A,B) = 2·var(A) and var(B) = 4·var(A)
    const cov = calculateCovarianceMatrix([
      [1, 2, 3, 4],
      [2, 4, 6, 8],
    ])
    expect(cov[0][0]).toBeCloseTo(5 / 3, 10)
    expect(cov[0][1]).toBeCloseTo(10 / 3, 10)
    expect(cov[1][1]).toBeCloseTo(20 / 3, 10)
  })

  it('is symmetric', () => {
    const cov = calculateCovarianceMatrix([
      [0.01, -0.02, 0.015, 0.004, -0.008],
      [0.005, -0.01, 0.02, -0.002, 0.011],
      [-0.012, 0.03, -0.005, 0.008, 0.001],
    ])
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        expect(cov[i][j]).toBeCloseTo(cov[j][i], 15)
      }
    }
  })

  it('puts the variance of each series on the diagonal', () => {
    const series = [0.01, -0.02, 0.015, 0.004, -0.008]
    const mean = series.reduce((a, b) => a + b, 0) / series.length
    const variance = series.reduce((a, b) => a + (b - mean) ** 2, 0) / (series.length - 1)
    const cov = calculateCovarianceMatrix([series])
    expect(cov[0][0]).toBeCloseTo(variance, 15)
  })

  it('produces a positive semi-definite matrix (xᵀΣx ≥ 0)', () => {
    const cov = calculateCovarianceMatrix([
      [0.01, -0.02, 0.015, 0.004, -0.008, 0.02],
      [0.005, -0.01, 0.02, -0.002, 0.011, -0.014],
      [-0.012, 0.03, -0.005, 0.008, 0.001, 0.006],
    ])
    const vectors = [
      [1, 0, 0],
      [1, 1, 1],
      [1, -2, 3],
      [-0.5, 0.25, 2],
    ]
    for (const x of vectors) {
      let quadratic = 0
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) quadratic += x[i] * cov[i][j] * x[j]
      }
      expect(quadratic).toBeGreaterThanOrEqual(-1e-15)
    }
  })

  it('degrades safely on empty or too-short input', () => {
    expect(calculateCovarianceMatrix([])).toEqual([])
    expect(calculateCovarianceMatrix([[0.01]])).toEqual([[0]])
    expect(calculateCovarianceMatrix([[], []])).toEqual([
      [0, 0],
      [0, 0],
    ])
  })
})

describe('choleskyDecomposition', () => {
  it('reconstructs a known 2x2 matrix exactly', () => {
    // Σ = [[4,2],[2,3]] has the textbook factor L = [[2,0],[1,√2]]
    const sigma = [
      [4, 2],
      [2, 3],
    ]
    const L = choleskyDecomposition(sigma)
    expect(L[0][0]).toBeCloseTo(2, 12)
    expect(L[0][1]).toBe(0)
    expect(L[1][0]).toBeCloseTo(1, 12)
    expect(L[1][1]).toBeCloseTo(Math.SQRT2, 12)
    expectReconstructs(L, sigma)
  })

  it('reconstructs a 3x3 symmetric positive definite matrix', () => {
    const sigma = [
      [25, 15, -5],
      [15, 18, 0],
      [-5, 0, 11],
    ]
    const L = choleskyDecomposition(sigma)
    expectReconstructs(L, sigma, 1e-8)
  })

  it('returns a lower triangular factor', () => {
    const L = choleskyDecomposition([
      [25, 15, -5],
      [15, 18, 0],
      [-5, 0, 11],
    ])
    for (let i = 0; i < 3; i++) {
      for (let j = i + 1; j < 3; j++) expect(L[i][j]).toBe(0)
    }
  })

  it('handles a singular positive semi-definite matrix (correlation ±1)', () => {
    // Perfectly correlated pair: Σ = [[a², ab],[ab, b²]] is singular.
    const a = 0.15
    const b = 0.35
    const sigma = [
      [a * a, a * b],
      [a * b, b * b],
    ]
    const L = choleskyDecomposition(sigma)
    expect(L.flat().every(Number.isFinite)).toBe(true)
    expectReconstructs(L, sigma, 1e-12)

    const antiSigma = [
      [a * a, -a * b],
      [-a * b, b * b],
    ]
    const antiL = choleskyDecomposition(antiSigma)
    expect(antiL.flat().every(Number.isFinite)).toBe(true)
    expectReconstructs(antiL, antiSigma, 1e-12)
  })

  it('round-trips a covariance matrix built from returns', () => {
    const sigma = calculateCovarianceMatrix([
      [0.01, -0.02, 0.015, 0.004, -0.008, 0.02],
      [0.005, -0.01, 0.02, -0.002, 0.011, -0.014],
      [-0.012, 0.03, -0.005, 0.008, 0.001, 0.006],
    ])
    expectReconstructs(choleskyDecomposition(sigma), sigma, 1e-12)
  })

  it('returns an empty factor for an empty matrix', () => {
    expect(choleskyDecomposition([])).toEqual([])
  })

  it('throws on a non-square matrix', () => {
    expect(() => choleskyDecomposition([[1, 2, 3], [4, 5, 6]])).toThrow(/square/)
  })
})
