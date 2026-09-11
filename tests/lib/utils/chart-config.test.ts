import { describe, it, expect } from 'vitest'
import {
  SERIES_PALETTE,
  SCATTER_SERIES_CAP,
  seriesColor,
  assignSeriesColors,
  foldToSeriesCap,
} from '@/lib/utils/chart-config'

describe('SERIES_PALETTE', () => {
  it('has exactly eight slots', () => {
    // Eight is the whole palette. A ninth series is never a generated hue —
    // it folds into "Other", facets, or a composite encoding.
    expect(SERIES_PALETTE).toHaveLength(8)
  })

  it('references design tokens, never literal colours', () => {
    for (const slot of SERIES_PALETTE) {
      expect(slot).toMatch(/^var\(--chart-[1-8]\)$/)
    }
  })

  it('lists every token exactly once, in order', () => {
    expect(SERIES_PALETTE).toEqual([
      'var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)',
      'var(--chart-5)', 'var(--chart-6)', 'var(--chart-7)', 'var(--chart-8)',
    ])
  })

  it('caps scatter-like forms below the full palette', () => {
    // All-pairs separation only holds for the first three slots; any two marks
    // in a scatter can end up side by side, so the cap is real.
    expect(SCATTER_SERIES_CAP).toBe(3)
    expect(SCATTER_SERIES_CAP).toBeLessThan(SERIES_PALETTE.length)
  })
})

describe('seriesColor', () => {
  it('assigns slots in fixed order', () => {
    expect(seriesColor(0)).toBe('var(--chart-1)')
    expect(seriesColor(3)).toBe('var(--chart-4)')
    expect(seriesColor(7)).toBe('var(--chart-8)')
  })

  it('does NOT cycle past the eighth slot', () => {
    // Wrapping would give two different entities the same colour, which is the
    // exact failure the fixed order exists to prevent.
    expect(seriesColor(8)).toBeNull()
    expect(seriesColor(20)).toBeNull()
  })

  it('refuses a negative or non-integer index', () => {
    expect(seriesColor(-1)).toBeNull()
    expect(seriesColor(1.5)).toBeNull()
  })
})

describe('assignSeriesColors', () => {
  it('pins a colour to each key by identity, not by position', () => {
    // Colour follows the entity. A filter that drops one series must not
    // repaint the survivors, so the mapping is keyed, not indexed.
    const all = assignSeriesColors(['market', 'size', 'value', 'momentum'])
    const filtered = assignSeriesColors(['market', 'value'], all)

    expect(filtered.value).toBe(all.value)
    expect(filtered.market).toBe(all.market)
  })

  it('gives new keys the first slots not already taken', () => {
    const existing = { a: 'var(--chart-1)', b: 'var(--chart-2)' }
    const result = assignSeriesColors(['a', 'b', 'c'], existing)
    expect(result.c).toBe('var(--chart-3)')
  })

  it('leaves a ninth key without a colour rather than reusing one', () => {
    const keys = Array.from({ length: 9 }, (_, i) => `k${i}`)
    const result = assignSeriesColors(keys)
    expect(result.k8).toBeUndefined()
    expect(Object.keys(result)).toHaveLength(8)
  })

  it('never gives two keys the same colour', () => {
    const result = assignSeriesColors(['a', 'b', 'c', 'd', 'e'])
    const used = Object.values(result)
    expect(new Set(used).size).toBe(used.length)
  })

  it('handles an empty list', () => {
    expect(assignSeriesColors([])).toEqual({})
  })
})

describe('foldToSeriesCap', () => {
  const rows = [
    { key: 'a', value: 50 },
    { key: 'b', value: 30 },
    { key: 'c', value: 12 },
    { key: 'd', value: 5 },
    { key: 'e', value: 3 },
  ]

  it('keeps everything when it already fits', () => {
    const result = foldToSeriesCap(rows, (r) => r.value, 8)
    expect(result.kept).toHaveLength(5)
    expect(result.otherValue).toBe(0)
  })

  it('keeps the largest and sums the rest into Other', () => {
    // "Other" costs one of the three slots, so only two real series survive.
    // Keeping three and adding Other would render four, which is the cap being
    // exceeded by exactly the thing meant to enforce it.
    const result = foldToSeriesCap(rows, (r) => r.value, 3)
    expect(result.kept.map((r) => r.key)).toEqual(['a', 'b'])
    expect(result.otherValue).toBe(20)
    expect(result.otherCount).toBe(3)
  })

  it('reserves a slot for Other, so the total never exceeds the cap', () => {
    const result = foldToSeriesCap(rows, (r) => r.value, 3)
    expect(result.kept.length + (result.otherCount > 0 ? 1 : 0)).toBeLessThanOrEqual(3)
  })

  it('preserves the total', () => {
    const result = foldToSeriesCap(rows, (r) => r.value, 3)
    const total = result.kept.reduce((s, r) => s + r.value, 0) + result.otherValue
    expect(total).toBe(100)
  })

  it('ignores a non-finite value rather than poisoning the sum', () => {
    const messy = [...rows, { key: 'bad', value: Number.NaN }]
    const result = foldToSeriesCap(messy, (r) => r.value, 3)
    expect(Number.isFinite(result.otherValue)).toBe(true)
  })

  it('handles an empty list', () => {
    expect(foldToSeriesCap([], () => 0, 3).kept).toEqual([])
  })
})
