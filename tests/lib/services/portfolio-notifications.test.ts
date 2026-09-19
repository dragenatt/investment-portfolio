import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  repricedValueSeries,
  extraordinaryMove,
  historyAgeDays,
  evaluatePortfolio,
  priceAlertFires,
  STALE_HISTORY_DAYS,
  type PriceAlertRow,
} from '@/lib/services/portfolio-notifications'
import { saveAlerts } from '@/lib/services/concentration'

// 4.5. The producer the notification table never had. Synthetic prices only:
// the repository is public.

const ASOF = new Date('2026-09-16T01:00:00Z')
const one = () => 1

/** `n` consecutive weekday-less daily dates ending on `last`. */
function dates(n: number, last = '2026-09-15'): string[] {
  const end = Date.parse(`${last}T00:00:00Z`)
  return Array.from({ length: n }, (_, i) => new Date(end - (n - 1 - i) * 86_400_000).toISOString().slice(0, 10))
}

/** A gently wiggling series (±0.5% a day) whose last close is `lastMove` away from the one before. */
function wiggle(n: number, lastMove = 0, start = 100, last?: string) {
  const ds = dates(n, last)
  let price = start
  return ds.map((date, i) => {
    if (i > 0) price *= i === n - 1 ? 1 + lastMove : 1 + (i % 2 === 0 ? 0.005 : -0.005)
    return { date, close: price }
  })
}

describe('repricedValueSeries', () => {
  it('values today\'s units at each day\'s close, converted at each day\'s rate', () => {
    const closes = {
      A: [{ date: 'd1', close: 10 }, { date: 'd2', close: 12 }],
      B: [{ date: 'd1', close: 100 }, { date: 'd2', close: 90 }],
    }
    // B quotes in a currency worth half the base on d1 and a quarter on d2.
    const factor = (symbol: string, date: string) => (symbol === 'B' ? (date === 'd1' ? 0.5 : 0.25) : 1)
    expect(repricedValueSeries(closes, { A: 2, B: 1 }, factor)).toEqual([
      { date: 'd1', value: 2 * 10 + 100 * 0.5 },
      { date: 'd2', value: 2 * 12 + 90 * 0.25 },
    ])
  })

  it('uses only the dates every covered holding has, and leaves out one with no history', () => {
    const closes = {
      A: [{ date: 'd1', close: 1 }, { date: 'd2', close: 1 }, { date: 'd3', close: 1 }],
      B: [{ date: 'd2', close: 5 }, { date: 'd3', close: 5 }],
    }
    const series = repricedValueSeries(closes, { A: 1, B: 1, C: 10 }, one)
    expect(series.map((p) => p.date)).toEqual(['d2', 'd3'])
    // C has no closes: valued at nothing would draw a fall that never happened.
    expect(series[0].value).toBe(6)
  })

  it('keeps only the lookback window', () => {
    const series = repricedValueSeries({ A: wiggle(300) }, { A: 1 }, one, 200)
    expect(series).toHaveLength(200)
  })
})

describe('extraordinaryMove', () => {
  it('reports a day far outside the holding\'s own range', () => {
    const move = extraordinaryMove('A', wiggle(80, -0.08), ASOF)
    expect(move).not.toBeNull()
    expect(move!.returnPct).toBeCloseTo(-8, 5)
    expect(move!.zScore).toBeLessThan(-3)
    expect(move!.date).toBe('2026-09-15')
  })

  it('stays quiet about an ordinary day', () => {
    expect(extraordinaryMove('A', wiggle(80, 0.005), ASOF)).toBeNull()
  })

  it('needs both a large z-score and a meaningful size', () => {
    // A very calm series: 0.05% a day, then 1%. Twenty sigma, and still not news.
    const calm = dates(80).map((date, i) => ({ date, close: 100 * (1 + (i % 2 === 0 ? 0.0005 : -0.0005)) }))
    calm[calm.length - 1] = { ...calm[calm.length - 1], close: calm[calm.length - 2].close * 1.01 }
    expect(extraordinaryMove('A', calm, ASOF)).toBeNull()
  })

  it('does not report an old move as news', () => {
    expect(extraordinaryMove('A', wiggle(80, -0.08, 100, '2026-09-01'), ASOF)).toBeNull()
  })

  it('does not judge a holding with too little history', () => {
    expect(extraordinaryMove('A', wiggle(15, -0.2), ASOF)).toBeNull()
  })
})

describe('evaluatePortfolio', () => {
  const base = {
    userId: 'u',
    portfolioId: 'p',
    portfolioName: 'Prueba',
    factor: one,
    concentration: [],
    asOf: ASOF,
  }

  it('warns about a drawdown of the book as it is held today', () => {
    // 100 → 130 → 110: 15.4% under the high.
    const ds = dates(3)
    const out = evaluatePortfolio({
      ...base,
      closes: { A: [{ date: ds[0], close: 100 }, { date: ds[1], close: 130 }, { date: ds[2], close: 110 }] },
      units: { A: 5 },
    })
    const drawdown = out.find((n) => n.kind === 'drawdown')!
    expect(drawdown.title).toContain('15.4%')
    expect(drawdown.severity).toBe('warning')
  })

  it('says nothing about a shallow dip', () => {
    const ds = dates(3)
    const out = evaluatePortfolio({
      ...base,
      closes: { A: [{ date: ds[0], close: 100 }, { date: ds[1], close: 104 }, { date: ds[2], close: 100 }] },
      units: { A: 5 },
    })
    expect(out.filter((n) => n.kind === 'drawdown')).toEqual([])
  })

  it('passes concentration findings through as portfolio notifications', () => {
    const out = evaluatePortfolio({
      ...base,
      closes: { A: wiggle(5) },
      units: { A: 1 },
      concentration: [{ portfolio_id: 'p', alert_type: 'position_concentration', severity: 'critical', message: 'A representa 100.0% de tu portafolio', details: { symbol: 'A', weight: 1 } }],
    })
    expect(out.map((n) => n.kind)).toContain('concentration:position_concentration:A')
  })

  it('flags a holding whose history stopped updating, and only past the threshold', () => {
    const stale = wiggle(30, 0, 100, '2026-09-01')
    const fresh = wiggle(30)
    const out = evaluatePortfolio({ ...base, closes: { OLD: stale, NEW: fresh }, units: { OLD: 1, NEW: 1 } })
    const kinds = out.map((n) => n.kind)
    expect(kinds).toContain('stale_price:OLD')
    expect(kinds).not.toContain('stale_price:NEW')
    expect(historyAgeDays('2026-09-01', ASOF)).toBeGreaterThan(STALE_HISTORY_DAYS)
  })
})

describe('priceAlertFires', () => {
  const alert = (condition: PriceAlertRow['condition'], target: number): PriceAlertRow => ({ id: 'a', user_id: 'u', symbol: 'A', condition, target_value: target })

  it('fires above and below at the line, not before', () => {
    expect(priceAlertFires(alert('above', 100), { price: 100, changePct: 0 })).toBe(true)
    expect(priceAlertFires(alert('above', 100), { price: 99.99, changePct: 0 })).toBe(false)
    expect(priceAlertFires(alert('below', 50), { price: 49, changePct: 0 })).toBe(true)
    expect(priceAlertFires(alert('below', 50), { price: 51, changePct: 0 })).toBe(false)
  })

  it('reads a daily-change alert as a move of that size either way', () => {
    expect(priceAlertFires(alert('pct_change_daily', 5), { price: 10, changePct: -5.2 })).toBe(true)
    expect(priceAlertFires(alert('pct_change_daily', 5), { price: 10, changePct: 4.9 })).toBe(false)
  })

  it('never fires without a usable quote', () => {
    expect(priceAlertFires(alert('above', 1), undefined)).toBe(false)
    expect(priceAlertFires(alert('below', 100), { price: null, changePct: null })).toBe(false)
    expect(priceAlertFires(alert('pct_change_daily', 1), { price: 10, changePct: null })).toBe(false)
  })
})

describe('saveAlerts', () => {
  function recorder() {
    const calls: string[] = []
    const chain = {
      delete: () => { calls.push('delete'); return chain },
      eq: () => chain,
      insert: vi.fn(async () => { calls.push('insert'); return { error: null } }),
      then: (resolve: (v: unknown) => void) => resolve({ error: null }),
    }
    const client = { from: () => chain } as unknown as SupabaseClient
    return { client, calls }
  }

  it('clears a portfolio\'s standing warnings even when tonight has none', async () => {
    // It used to return early on an empty list, so a fixed concentration kept
    // its warning on screen.
    const { client, calls } = recorder()
    await saveAlerts(client, 'p', [])
    expect(calls).toEqual(['delete'])
  })

  it('replaces them with tonight\'s findings', async () => {
    const { client, calls } = recorder()
    await saveAlerts(client, 'p', [{ portfolio_id: 'p', alert_type: 'x', severity: 'warning', message: 'm', details: {} }])
    expect(calls).toEqual(['delete', 'insert'])
  })
})
