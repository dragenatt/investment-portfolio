import { describe, it, expect } from 'vitest'
import {
  HISTORICAL_EPISODES,
  episodeReturn,
  stressTestPortfolio,
  describeStressResult,
  type PriceBar,
} from '@/lib/services/stress-testing'

/** A daily series from `from`, falling (or rising) at a constant rate. */
function ramp(from: string, days: number, start: number, dailyRate: number): PriceBar[] {
  const bars: PriceBar[] = []
  const cursor = new Date(`${from}T00:00:00Z`)
  let close = start
  for (let i = 0; i < days; i++) {
    bars.push({ date: cursor.toISOString().slice(0, 10), close })
    close *= 1 + dailyRate
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return bars
}

const GFC = HISTORICAL_EPISODES.find((e) => e.id === 'gfc2008')!

describe('HISTORICAL_EPISODES', () => {
  it('is not empty and every episode is uniquely identified', () => {
    expect(HISTORICAL_EPISODES.length).toBeGreaterThanOrEqual(5)
    const ids = HISTORICAL_EPISODES.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('cites a source for every episode, because the roadmap forbids inventing them', () => {
    for (const episode of HISTORICAL_EPISODES) {
      expect(episode.source.length).toBeGreaterThan(10)
      expect(episode.description.length).toBeGreaterThan(40)
    }
  })

  it('gives every episode a peak that precedes its trough', () => {
    for (const episode of HISTORICAL_EPISODES) {
      expect(episode.from < episode.to).toBe(true)
      expect(episode.from).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(episode.to).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })

  it('states no drawdown figure of its own', () => {
    // The magnitude must come from price data at read time, never from a number
    // typed into this catalogue. Dates are public record; declines are computed.
    for (const episode of HISTORICAL_EPISODES) {
      expect(episode).not.toHaveProperty('declinePct')
      expect(episode).not.toHaveProperty('drawdown')
    }
  })

  it('runs newest first', () => {
    for (let i = 1; i < HISTORICAL_EPISODES.length; i++) {
      expect(HISTORICAL_EPISODES[i].from < HISTORICAL_EPISODES[i - 1].from).toBe(true)
    }
  })
})

describe('episodeReturn', () => {
  it('measures the fall between the first and last bar in the window', () => {
    // 100 down to 50 over the window
    const bars = [
      { date: '2007-10-09', close: 100 },
      { date: '2008-06-01', close: 70 },
      { date: '2009-03-09', close: 50 },
    ]
    expect(episodeReturn(bars, GFC)!.returnPct).toBeCloseTo(-50, 8)
  })

  it('reports the deepest point inside the window, not just the endpoints', () => {
    const bars = [
      { date: '2007-10-09', close: 100 },
      { date: '2008-11-20', close: 40 },
      { date: '2009-03-09', close: 60 },
    ]
    const result = episodeReturn(bars, GFC)!
    expect(result.returnPct).toBeCloseTo(-40, 8)
    expect(result.maxDrawdownPct).toBeCloseTo(60, 8)
  })

  it('ignores bars outside the window entirely', () => {
    const bars = [
      { date: '2006-01-01', close: 10 },
      { date: '2007-10-09', close: 100 },
      { date: '2009-03-09', close: 50 },
      { date: '2010-01-01', close: 999 },
    ]
    expect(episodeReturn(bars, GFC)!.returnPct).toBeCloseTo(-50, 8)
  })

  it('returns null when the asset did not exist yet', () => {
    expect(episodeReturn(ramp('2015-01-01', 100, 100, -0.001), GFC)).toBeNull()
  })

  it('returns null when the series starts well after the peak', () => {
    // Half a year late is not the same episode
    expect(episodeReturn(ramp('2008-06-01', 300, 100, -0.001), GFC)).toBeNull()
  })

  it('accepts monthly bars, whose first point necessarily lags the peak date', () => {
    // Long ranges only come back monthly from the provider chain, so a fixed
    // day tolerance would reject every episode before 2020 outright. The gate
    // is relative to the series' own cadence instead: one sampling interval of
    // lag is the data's granularity, not a missing asset.
    const monthly: PriceBar[] = [
      { date: '2007-11-01', close: 100 },
      { date: '2007-12-01', close: 95 },
      { date: '2008-01-01', close: 88 },
      { date: '2008-06-01', close: 80 },
      { date: '2008-12-01', close: 55 },
      { date: '2009-03-01', close: 45 },
    ]
    const result = episodeReturn(monthly, GFC)
    expect(result).not.toBeNull()
    expect(result!.returnPct).toBeCloseTo(-55, 8)
  })

  it('still rejects a monthly series that starts months into the episode', () => {
    const late: PriceBar[] = [
      { date: '2008-06-01', close: 100 },
      { date: '2008-12-01', close: 70 },
      { date: '2009-03-01', close: 60 },
    ]
    expect(episodeReturn(late, GFC)).toBeNull()
  })

  it('returns null for a window with a single bar', () => {
    expect(episodeReturn([{ date: '2007-10-09', close: 100 }], GFC)).toBeNull()
  })

  it('returns null rather than dividing by a zero opening price', () => {
    const bars = [
      { date: '2007-10-09', close: 0 },
      { date: '2009-03-09', close: 50 },
    ]
    expect(episodeReturn(bars, GFC)).toBeNull()
  })

  it('handles a rise, since not every window is a fall for every asset', () => {
    const bars = [
      { date: '2007-10-09', close: 100 },
      { date: '2009-03-09', close: 150 },
    ]
    const result = episodeReturn(bars, GFC)!
    expect(result.returnPct).toBeCloseTo(50, 8)
    expect(result.maxDrawdownPct).toBeCloseTo(0, 8)
  })
})

describe('stressTestPortfolio', () => {
  const holdings = [
    { symbol: 'OLD', weight: 0.5 },
    { symbol: 'ALSO_OLD', weight: 0.5 },
  ]

  const covering = new Map<string, PriceBar[]>([
    ['OLD', [
      { date: '2007-10-09', close: 100 },
      { date: '2009-03-09', close: 40 },
    ]],
    ['ALSO_OLD', [
      { date: '2007-10-09', close: 200 },
      { date: '2009-03-09', close: 160 },
    ]],
    ['SPY', [
      { date: '2007-10-09', close: 157 },
      { date: '2009-03-09', close: 68 },
    ]],
  ])

  it('weights each holding return into a portfolio return', () => {
    // -60% and -20% at 50/50 is -40%
    const results = stressTestPortfolio(holdings, covering, 'SPY', [GFC])
    expect(results[0].portfolioReturnPct).toBeCloseTo(-40, 6)
  })

  it('reports the benchmark alongside, so the book has something to be read against', () => {
    const results = stressTestPortfolio(holdings, covering, 'SPY', [GFC])
    expect(results[0].benchmarkReturnPct!).toBeCloseTo(((68 - 157) / 157) * 100, 6)
  })

  it('marks an episode fully covered by real data as observed', () => {
    const results = stressTestPortfolio(holdings, covering, 'SPY', [GFC])
    expect(results[0].coverage).toBe('observed')
    expect(results[0].observedWeightPct).toBeCloseTo(100, 8)
  })

  it('estimates a holding that did not exist yet from its beta, and says so', () => {
    const withNew = [
      { symbol: 'OLD', weight: 0.5 },
      { symbol: 'NEW', weight: 0.5, beta: 1.5 },
    ]
    const prices = new Map(covering)
    prices.set('NEW', ramp('2015-01-01', 100, 50, 0.001))

    const results = stressTestPortfolio(withNew, prices, 'SPY', [GFC])
    const estimated = results[0].holdings.find((h) => h.symbol === 'NEW')!
    expect(estimated.coverage).toBe('estimated')
    // beta 1.5 against a benchmark that fell ~56.7%
    expect(estimated.returnPct!).toBeCloseTo(1.5 * ((68 - 157) / 157) * 100, 6)
    expect(results[0].coverage).toBe('estimated')
  })

  it('leaves a holding with neither history nor beta out, and discloses the gap', () => {
    const withUnknown = [
      { symbol: 'OLD', weight: 0.6 },
      { symbol: 'MYSTERY', weight: 0.4 },
    ]
    const results = stressTestPortfolio(withUnknown, covering, 'SPY', [GFC])
    const mystery = results[0].holdings.find((h) => h.symbol === 'MYSTERY')!

    expect(mystery.coverage).toBe('unavailable')
    expect(mystery.returnPct).toBeNull()
    expect(results[0].observedWeightPct).toBeCloseTo(60, 6)
    // The 60% that can be measured fell 60%, and that is what is reported —
    // renormalised, with the share it covers stated beside it
    expect(results[0].portfolioReturnPct).toBeCloseTo(-60, 6)
  })

  it('returns nothing for an episode no holding can speak to', () => {
    const recent = new Map<string, PriceBar[]>([
      ['NEW', ramp('2015-01-01', 100, 50, 0.001)],
    ])
    const results = stressTestPortfolio([{ symbol: 'NEW', weight: 1 }], recent, 'SPY', [GFC])
    expect(results).toEqual([])
  })

  it('never emits a non-finite number', () => {
    const results = stressTestPortfolio(holdings, covering, 'SPY')
    for (const result of results) {
      expect(Number.isFinite(result.portfolioReturnPct)).toBe(true)
      expect(Number.isFinite(result.observedWeightPct)).toBe(true)
      expect(
        result.benchmarkReturnPct === null || Number.isFinite(result.benchmarkReturnPct),
      ).toBe(true)
      for (const holding of result.holdings) {
        expect(holding.returnPct === null || Number.isFinite(holding.returnPct)).toBe(true)
      }
    }
  })

  it('refuses weights that do not sum to 1', () => {
    expect(
      stressTestPortfolio([{ symbol: 'OLD', weight: 0.3 }], covering, 'SPY', [GFC]),
    ).toEqual([])
  })

  it('handles an empty portfolio', () => {
    expect(stressTestPortfolio([], covering, 'SPY', [GFC])).toEqual([])
  })

  it('is deterministic', () => {
    expect(stressTestPortfolio(holdings, covering, 'SPY')).toEqual(
      stressTestPortfolio(holdings, covering, 'SPY'),
    )
  })
})

describe('describeStressResult', () => {
  const base = {
    episode: GFC,
    coverage: 'observed' as const,
    observedWeightPct: 100,
    benchmarkReturnPct: -56.7,
    portfolioReturnPct: -40,
    maxDrawdownPct: 42,
    holdings: [],
    worst: null,
  }

  it('says what happened and that it is history, not a forecast', () => {
    const text = describeStressResult(base)
    expect(text).toMatch(/40/)
    expect(text.toLowerCase()).toMatch(/no (es|predice)|pasado|historic/)
    expect(text.length).toBeGreaterThan(80)
  })

  it('reads a book that held up better than the market differently', () => {
    const resilient = describeStressResult({ ...base, portfolioReturnPct: -20 })
    const fragile = describeStressResult({ ...base, portfolioReturnPct: -70 })
    expect(resilient).not.toBe(fragile)
  })

  it('warns when most of the book could not be measured', () => {
    const text = describeStressResult({
      ...base,
      coverage: 'estimated',
      observedWeightPct: 25,
    })
    expect(text).toMatch(/25/)
  })

  it('does not claim a portfolio gain is a promise', () => {
    const text = describeStressResult({ ...base, portfolioReturnPct: 12 })
    expect(text.length).toBeGreaterThan(60)
  })
})

// ─── Saying truthfully why an episode was not measured ──────────────────────

import { unmeasuredReason, HISTORICAL_EPISODES as EPISODES } from '@/lib/services/stress-testing'

describe('unmeasuredReason', () => {
  const covid = EPISODES.find((e) => e.id.includes('covid')) ?? EPISODES[1]

  it('blames the monthly bars, not missing history, when the series spans a short episode', () => {
    // Month-end closes around a crash that lasted less than a month.
    const monthly = ['2019-12-31', '2020-01-31', '2020-02-28', '2020-03-31', '2020-04-30'].map((date, i) => ({ date, close: 100 - i }))
    const reason = unmeasuredReason({ ...covid, from: '2020-02-19', to: '2020-03-23' }, new Map([['AAA', monthly]]), ['AAA'])
    expect(reason).toMatch(/un cierre por mes/)
  })

  it('says there is no history when nothing covers the period', () => {
    const recent = [{ date: '2024-01-02', close: 10 }, { date: '2024-01-03', close: 11 }]
    expect(unmeasuredReason(covid, new Map([['AAA', recent]]), ['AAA'])).toMatch(/tiene historial ni beta/)
  })
})
