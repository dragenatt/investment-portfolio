import { describe, it, expect } from 'vitest'
import { compareAssets, type Bar } from '@/lib/services/asset-compare'

function series(n: number, dailyPct: number, start = 100, from = '2024-01-01'): Bar[] {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(`${from}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() + i)
    return {
      date: d.toISOString().slice(0, 10),
      close: Number((start * Math.pow(1 + dailyPct, i)).toFixed(6)),
    }
  })
}

/** A series that wobbles as well as trends, so volatility is not zero. */
function wobbly(n: number, drift: number, amplitude: number, phase = 0, start = 100): Bar[] {
  return series(n, drift, start).map((bar, i) => ({
    ...bar,
    close: Number((bar.close * (1 + amplitude * Math.sin(i / 5 + phase))).toFixed(6)),
  }))
}

const A = wobbly(300, 0.0012, 0.03)
const B = wobbly(300, 0.0004, 0.01, 2)

describe('compareAssets — the common window', () => {
  it('measures every asset over the dates they all share', () => {
    const short = wobbly(120, 0.001, 0.02)
    const result = compareAssets({ A, SHORT: short })!
    expect(result.observations).toBe(120)
    expect(result.assets.every((a) => a.observations === 120)).toBe(true)
  })

  it('reports the window it actually used', () => {
    const result = compareAssets({ A, B })!
    expect(result.from).toBe(A[0].date)
    expect(result.to).toBe(A[A.length - 1].date)
  })

  it('excludes an asset with no usable prices instead of dropping it silently', () => {
    const result = compareAssets({ A, EMPTY: [] })!
    expect(result.excluded).toContain('EMPTY')
    expect(result.assets.map((a) => a.symbol)).not.toContain('EMPTY')
  })

  it('refuses a comparison with too little overlap to mean anything', () => {
    expect(compareAssets({ A, TINY: series(3, 0.001) })).toBeNull()
    expect(compareAssets({})).toBeNull()
  })
})

describe('compareAssets — metrics', () => {
  it('ranks the faster grower higher on return', () => {
    const result = compareAssets({ A, B })!
    const a = result.assets.find((x) => x.symbol === 'A')!
    const b = result.assets.find((x) => x.symbol === 'B')!
    expect(a.totalReturnPct).toBeGreaterThan(b.totalReturnPct)
  })

  it('gives the choppier asset higher volatility', () => {
    const result = compareAssets({ A, B })!
    const a = result.assets.find((x) => x.symbol === 'A')!
    const b = result.assets.find((x) => x.symbol === 'B')!
    expect(a.volatilityPct).toBeGreaterThan(b.volatilityPct)
  })

  it('reports drawdown and what it takes to undo it', () => {
    const result = compareAssets({ A, B })!
    for (const asset of result.assets) {
      expect(asset.maxDrawdownPct).toBeGreaterThan(0)
      // Recovering always costs more than the fall
      expect(asset.recoveryRequiredPct).toBeGreaterThan(asset.maxDrawdownPct)
    }
  })

  it('reports tail risk for each asset', () => {
    const result = compareAssets({ A, B })!
    for (const asset of result.assets) {
      expect(asset.var95Pct).not.toBeNull()
      expect(asset.cvar95Pct!).toBeGreaterThanOrEqual(asset.var95Pct!)
    }
  })

  it('computes beta against a nominated benchmark', () => {
    const result = compareAssets({ A, B }, { benchmarkSymbol: 'B' })!
    const a = result.assets.find((x) => x.symbol === 'A')!
    const b = result.assets.find((x) => x.symbol === 'B')!
    expect(a.beta).not.toBeNull()
    // The benchmark has no beta against itself worth reporting
    expect(b.beta).toBeNull()
  })

  it('leaves beta null when no benchmark is named', () => {
    expect(compareAssets({ A, B })!.assets.every((a) => a.beta === null)).toBe(true)
  })

  it('never emits a non-finite number', () => {
    const flat: Bar[] = series(200, 0, 50)
    const result = compareAssets({ A, FLAT: flat })!
    for (const asset of result.assets) {
      for (const value of [asset.totalReturnPct, asset.volatilityPct, asset.maxDrawdownPct]) {
        expect(Number.isFinite(value)).toBe(true)
      }
      expect(asset.sharpe === null || Number.isFinite(asset.sharpe)).toBe(true)
    }
  })
})

describe('compareAssets — correlation', () => {
  it('reports one figure per pair', () => {
    const result = compareAssets({ A, B, C: wobbly(300, 0.0008, 0.02, 1) })!
    expect(result.correlations).toHaveLength(3) // 3 choose 2
  })

  it('finds a perfect correlation between an asset and a scaled copy of itself', () => {
    const scaled = A.map((bar) => ({ ...bar, close: bar.close * 3 }))
    const result = compareAssets({ A, SCALED: scaled })!
    expect(result.correlations[0].correlation).toBeCloseTo(1, 6)
  })

  it('keeps every correlation inside -1 and 1', () => {
    const result = compareAssets({ A, B, C: wobbly(300, 0.0008, 0.02, 1) })!
    for (const pair of result.correlations) {
      expect(pair.correlation).toBeGreaterThanOrEqual(-1.000001)
      expect(pair.correlation).toBeLessThanOrEqual(1.000001)
    }
  })
})

describe('compareAssets — normalised curves', () => {
  it('starts every asset at the same invested amount', () => {
    const result = compareAssets({ A, B }, { initialInvestment: 10000 })!
    const first = result.normalised[0]
    expect(first.values.A).toBeCloseTo(10000, 6)
    expect(first.values.B).toBeCloseTo(10000, 6)
  })

  it('ends where the total return says it should', () => {
    const result = compareAssets({ A, B }, { initialInvestment: 10000 })!
    const last = result.normalised[result.normalised.length - 1]
    const a = result.assets.find((x) => x.symbol === 'A')!
    expect(last.values.A).toBeCloseTo(a.finalValueOfInitial, 4)
  })

  it('has one point per date in the common window', () => {
    const result = compareAssets({ A, B })!
    expect(result.normalised).toHaveLength(result.observations)
  })
})

describe('compareAssets — framing', () => {
  it('warns that the biggest riser is not automatically the best holding', () => {
    const result = compareAssets({ A, B })!
    expect(result.note).toMatch(/caida|recuper/i)
    expect(result.note.length).toBeGreaterThan(60)
  })

  it('is deterministic', () => {
    expect(compareAssets({ A, B })).toEqual(compareAssets({ A, B }))
  })
})
