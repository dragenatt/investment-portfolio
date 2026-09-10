import { describe, it, expect } from 'vitest'
import {
  DEFAULT_COST_MODEL,
  tradeCost,
  applyCostsToReturn,
  annualDrag,
  rebalanceCost,
  describeCostModel,
  type CostModel,
} from '@/lib/services/costs'

const broker: CostModel = {
  commissionPct: 0.25,
  commissionMin: 1,
  spreadPct: 0.05,
  custodyAnnualPct: 0.1,
  capitalGainsTaxPct: 10,
  source: 'GBM tarifario 2026',
}

describe('DEFAULT_COST_MODEL', () => {
  it('is all zeros, because inventing a cost is worse than omitting one', () => {
    expect(DEFAULT_COST_MODEL.commissionPct).toBe(0)
    expect(DEFAULT_COST_MODEL.spreadPct).toBe(0)
    expect(DEFAULT_COST_MODEL.custodyAnnualPct).toBe(0)
    expect(DEFAULT_COST_MODEL.capitalGainsTaxPct).toBe(0)
  })

  it('says outright that nothing is configured', () => {
    expect(DEFAULT_COST_MODEL.source).toMatch(/no|sin|none/i)
  })
})

describe('tradeCost', () => {
  it('charges commission and spread on the traded value', () => {
    // 10,000 x (0.25% + 0.05%) = 30
    expect(tradeCost(10000, broker)).toBeCloseTo(30, 6)
  })

  it('applies the commission minimum on a small trade', () => {
    // 100 x 0.25% = 0.25, below the 1.00 minimum, so commission is 1.00
    // plus 100 x 0.05% spread = 0.05
    expect(tradeCost(100, broker)).toBeCloseTo(1.05, 6)
  })

  it('is zero under a model with no costs configured', () => {
    expect(tradeCost(10000, DEFAULT_COST_MODEL)).toBe(0)
  })

  it('never charges on a trade of nothing', () => {
    expect(tradeCost(0, broker)).toBe(0)
  })

  it('treats a sale the same as a purchase', () => {
    expect(tradeCost(-10000, broker)).toBeCloseTo(tradeCost(10000, broker), 6)
  })

  it('returns money to the cent', () => {
    const cost = tradeCost(3333.33, broker)
    expect(Math.round(cost * 100) / 100).toBe(cost)
  })
})

describe('applyCostsToReturn', () => {
  it('leaves a gross return untouched when nothing is configured', () => {
    const result = applyCostsToReturn(12, 1, DEFAULT_COST_MODEL)!
    expect(result.netReturnPct).toBeCloseTo(12)
    expect(result.totalDragPct).toBe(0)
  })

  it('subtracts custody, trading and tax from the gross return', () => {
    // 12% gross, one round trip a year, 0.1% custody
    const result = applyCostsToReturn(12, 1, broker)!
    expect(result.netReturnPct).toBeLessThan(12)
    expect(result.grossReturnPct).toBe(12)
    expect(result.totalDragPct).toBeCloseTo(12 - result.netReturnPct, 8)
  })

  it('breaks the drag into its parts, which add to the whole', () => {
    const result = applyCostsToReturn(12, 2, broker)!
    const parts =
      result.breakdown.tradingPct + result.breakdown.custodyPct + result.breakdown.taxPct
    expect(parts).toBeCloseTo(result.totalDragPct, 8)
  })

  it('charges more trading cost for more turnover', () => {
    const quiet = applyCostsToReturn(12, 1, broker)!
    const busy = applyCostsToReturn(12, 6, broker)!
    expect(busy.netReturnPct).toBeLessThan(quiet.netReturnPct)
  })

  it('taxes only the gain, never the principal', () => {
    const loss = applyCostsToReturn(-8, 0, { ...broker, custodyAnnualPct: 0, commissionPct: 0, spreadPct: 0 })!
    expect(loss.breakdown.taxPct).toBe(0)
    expect(loss.netReturnPct).toBeCloseTo(-8)
  })

  it('refuses inputs that are not finite', () => {
    expect(applyCostsToReturn(Number.NaN, 1, broker)).toBeNull()
    expect(applyCostsToReturn(12, Number.NaN, broker)).toBeNull()
  })
})

describe('annualDrag', () => {
  it('compounds the cost gap over a horizon', () => {
    // 8% gross vs 7% net over 20 years on 100,000
    const result = annualDrag(100000, 8, 7, 20)!
    expect(result.grossValue).toBeGreaterThan(result.netValue)
    expect(result.costOfCosts).toBeCloseTo(result.grossValue - result.netValue, 2)
  })

  it('shows the gap growing with the horizon', () => {
    const short = annualDrag(100000, 8, 7, 5)!
    const long = annualDrag(100000, 8, 7, 30)!
    expect(long.costOfCosts).toBeGreaterThan(short.costOfCosts)
  })

  it('is zero when there is no gap', () => {
    expect(annualDrag(100000, 8, 8, 20)!.costOfCosts).toBeCloseTo(0, 2)
  })

  it('states the compounding effect in words', () => {
    const result = annualDrag(100000, 8, 7, 20)!
    expect(result.explanation).toMatch(/1(\.0)?%|punto/i)
    expect(result.explanation.length).toBeGreaterThan(40)
  })

  it('refuses a negative horizon', () => {
    expect(annualDrag(100000, 8, 7, -1)).toBeNull()
  })
})

describe('rebalanceCost', () => {
  it('charges each side of the money that actually moves', () => {
    // 2,000 sold and 2,000 bought is 2,000 of turnover, charged once per side
    const cost = rebalanceCost([-2000, 1200, 800], broker)
    expect(cost.turnover).toBeCloseTo(2000)
    expect(cost.total).toBeGreaterThan(0)
  })

  it('is zero when nothing moves', () => {
    expect(rebalanceCost([0, 0, 0], broker).total).toBe(0)
  })

  it('is zero with no cost model configured', () => {
    expect(rebalanceCost([-2000, 2000], DEFAULT_COST_MODEL).total).toBe(0)
  })

  it('says what share of the book the cost represents', () => {
    const cost = rebalanceCost([-2000, 2000], broker, 100000)
    expect(cost.pctOfPortfolio).toBeGreaterThan(0)
    expect(cost.pctOfPortfolio).toBeLessThan(1)
  })
})

describe('describeCostModel', () => {
  it('names the source when there is one', () => {
    expect(describeCostModel(broker)).toContain('GBM tarifario 2026')
  })

  it('says plainly that returns are gross when nothing is configured', () => {
    const text = describeCostModel(DEFAULT_COST_MODEL)
    expect(text).toMatch(/brutos|gross/i)
    expect(text.length).toBeGreaterThan(40)
  })
})
