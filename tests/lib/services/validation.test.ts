import { describe, it, expect } from 'vitest'
import {
  findInvalidNumbers,
  sanitizeFinancialPayload,
  validateWeights,
  validateProbability,
  validateVolatility,
  validateReturnPct,
  validateCovarianceMatrix,
} from '@/lib/services/validation'

describe('findInvalidNumbers', () => {
  it('finds nothing in a clean payload', () => {
    expect(findInvalidNumbers({ sharpe: 0.82, nested: { vol: 0.15 }, list: [1, 2, 3] })).toEqual([])
  })

  it('names the path to a NaN', () => {
    expect(findInvalidNumbers({ current: { sharpe_ratio: Number.NaN } })).toEqual([
      'current.sharpe_ratio',
    ])
  })

  it('names the path to an Infinity', () => {
    expect(findInvalidNumbers({ ratio: Number.POSITIVE_INFINITY })).toEqual(['ratio'])
    expect(findInvalidNumbers({ ratio: Number.NEGATIVE_INFINITY })).toEqual(['ratio'])
  })

  it('indexes into arrays', () => {
    expect(findInvalidNumbers({ series: [1, Number.NaN, 3] })).toEqual(['series[1]'])
  })

  it('finds several at once', () => {
    const paths = findInvalidNumbers({ a: Number.NaN, b: { c: Number.POSITIVE_INFINITY } })
    expect(paths).toContain('a')
    expect(paths).toContain('b.c')
  })

  it('leaves nulls and strings alone — absent is not invalid', () => {
    expect(findInvalidNumbers({ beta: null, label: 'n/a', ok: true })).toEqual([])
  })

  it('handles a payload that references itself without hanging', () => {
    const cyclic: Record<string, unknown> = { value: 1 }
    cyclic.self = cyclic
    expect(findInvalidNumbers(cyclic)).toEqual([])
  })

  it('handles primitives and empty input', () => {
    expect(findInvalidNumbers(null)).toEqual([])
    expect(findInvalidNumbers(42)).toEqual([])
    expect(findInvalidNumbers(Number.NaN)).toEqual(['<root>'])
  })
})

describe('sanitizeFinancialPayload', () => {
  it('returns a clean payload untouched', () => {
    const payload = { sharpe: 0.82, list: [1, 2] }
    expect(sanitizeFinancialPayload(payload)).toEqual({ payload, replaced: [] })
  })

  it('replaces an invalid number with null rather than shipping it', () => {
    const result = sanitizeFinancialPayload({ current: { sharpe: Number.NaN, vol: 0.2 } })
    expect(result.payload).toEqual({ current: { sharpe: null, vol: 0.2 } })
    expect(result.replaced).toEqual(['current.sharpe'])
  })

  it('replaces inside arrays and keeps their length', () => {
    const result = sanitizeFinancialPayload({ series: [1, Number.NaN, 3] })
    expect(result.payload).toEqual({ series: [1, null, 3] })
  })

  it('does not mutate the input', () => {
    const input = { a: Number.NaN }
    sanitizeFinancialPayload(input)
    expect(Number.isNaN(input.a)).toBe(true)
  })

  it('turns a bare invalid number into null', () => {
    expect(sanitizeFinancialPayload(Number.NaN).payload).toBeNull()
  })
})

describe('validateWeights', () => {
  it('accepts weights that sum to one', () => {
    expect(validateWeights([0.5, 0.3, 0.2]).valid).toBe(true)
  })

  it('accepts a rounding-sized deviation', () => {
    expect(validateWeights([0.3333, 0.3333, 0.3334]).valid).toBe(true)
  })

  it('rejects weights that do not sum to one', () => {
    const result = validateWeights([0.5, 0.3])
    expect(result.valid).toBe(false)
    expect(result.reason).toMatch(/sum/i)
  })

  it('rejects a negative weight when shorting is not allowed', () => {
    const result = validateWeights([1.4, -0.4])
    expect(result.valid).toBe(false)
    expect(result.reason).toMatch(/negative/i)
  })

  it('allows a negative weight when the caller permits shorts', () => {
    expect(validateWeights([1.4, -0.4], { allowNegative: true }).valid).toBe(true)
  })

  it('rejects a non-finite weight', () => {
    expect(validateWeights([Number.NaN, 1]).valid).toBe(false)
  })

  it('rejects an empty set — no weights is not the same as valid weights', () => {
    expect(validateWeights([]).valid).toBe(false)
  })
})

describe('validateProbability', () => {
  it('accepts the closed unit interval', () => {
    expect(validateProbability(0).valid).toBe(true)
    expect(validateProbability(0.5).valid).toBe(true)
    expect(validateProbability(1).valid).toBe(true)
  })

  it('rejects anything outside it', () => {
    expect(validateProbability(-0.01).valid).toBe(false)
    expect(validateProbability(1.01).valid).toBe(false)
    expect(validateProbability(Number.NaN).valid).toBe(false)
  })

  it('accepts a percentage when told to', () => {
    expect(validateProbability(72, { scale: 'percent' }).valid).toBe(true)
    expect(validateProbability(101, { scale: 'percent' }).valid).toBe(false)
  })
})

describe('validateVolatility', () => {
  it('accepts a plausible annual volatility', () => {
    expect(validateVolatility(0.18).valid).toBe(true)
  })

  it('rejects a negative volatility, which has no meaning', () => {
    expect(validateVolatility(-0.1).valid).toBe(false)
  })

  it('rejects an impossible volatility', () => {
    expect(validateVolatility(50).valid).toBe(false)
  })
})

describe('validateReturnPct', () => {
  it('accepts ordinary returns', () => {
    expect(validateReturnPct(12.5).valid).toBe(true)
    expect(validateReturnPct(-30).valid).toBe(true)
  })

  it('rejects a loss worse than everything', () => {
    // You cannot lose more than 100% of a long, unlevered position
    expect(validateReturnPct(-101).valid).toBe(false)
  })

  it('rejects a non-finite return', () => {
    expect(validateReturnPct(Number.POSITIVE_INFINITY).valid).toBe(false)
  })
})

describe('validateCovarianceMatrix', () => {
  it('accepts a symmetric matrix with a non-negative diagonal', () => {
    expect(validateCovarianceMatrix([[0.04, 0.01], [0.01, 0.09]]).valid).toBe(true)
  })

  it('rejects a non-square matrix', () => {
    expect(validateCovarianceMatrix([[0.04, 0.01]]).valid).toBe(false)
  })

  it('rejects an asymmetric matrix', () => {
    const result = validateCovarianceMatrix([[0.04, 0.01], [0.05, 0.09]])
    expect(result.valid).toBe(false)
    expect(result.reason).toMatch(/symmetric/i)
  })

  it('rejects a negative variance on the diagonal', () => {
    expect(validateCovarianceMatrix([[-0.04, 0], [0, 0.09]]).valid).toBe(false)
  })

  it('rejects a correlation implied above one', () => {
    // |cov(i,j)| cannot exceed sigma_i * sigma_j
    const result = validateCovarianceMatrix([[0.04, 0.5], [0.5, 0.09]])
    expect(result.valid).toBe(false)
  })

  it('rejects a matrix with a NaN in it', () => {
    expect(validateCovarianceMatrix([[Number.NaN, 0], [0, 0.09]]).valid).toBe(false)
  })

  it('rejects an empty matrix', () => {
    expect(validateCovarianceMatrix([]).valid).toBe(false)
  })
})
