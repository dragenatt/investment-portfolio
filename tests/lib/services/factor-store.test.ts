import { describe, it, expect } from 'vitest'
import { factorRebuildDue } from '@/lib/services/factor-store'
import { TOP_UP_RETRY_MS } from '@/lib/services/price-history'
import type { BuiltFactorReturns } from '@/lib/services/factors'

const tuesday = new Date('2026-09-15T16:00:00Z')

const series = (lastDate: string, factorIds: string[], omitted: string[] = []): BuiltFactorReturns => ({
  dates: ['2026-09-10', lastDate],
  factors: factorIds.map((id) => ({ id, name: id, returns: [0, 0] })),
  omitted: omitted.map((id) => ({ id, missing: ['X'] })),
})

describe('factorRebuildDue', () => {
  it('builds when nothing is stored', () => {
    expect(factorRebuildDue(null, null, tuesday)).toBe(true)
  })

  it('serves a current, complete series', () => {
    expect(factorRebuildDue(series('2026-09-14', ['market', 'size']), null, tuesday)).toBe(false)
  })

  it('rebuilds the series production had: market only, ending on 2026-09-11', () => {
    expect(factorRebuildDue(series('2026-09-11', ['market'], ['size', 'value', 'momentum', 'quality', 'lowVolatility']), null, tuesday)).toBe(true)
    // Complete but stale, and current but incomplete, are each enough.
    expect(factorRebuildDue(series('2026-09-11', ['market', 'size']), null, tuesday)).toBe(true)
    expect(factorRebuildDue(series('2026-09-14', ['market'], ['size']), null, tuesday)).toBe(true)
  })

  it('tries at most once per retry window', () => {
    const stale = series('2026-09-11', ['market'])
    expect(factorRebuildDue(stale, tuesday.getTime() - 60_000, tuesday)).toBe(false)
    expect(factorRebuildDue(stale, tuesday.getTime() - TOP_UP_RETRY_MS, tuesday)).toBe(true)
  })
})
