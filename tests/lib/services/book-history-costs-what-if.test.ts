import { describe, it, expect } from 'vitest'
import { summariseBookHistory, type RawTransaction } from '@/lib/services/trade-history'
import { costModelFrom, isCostModelConfigured, rebalanceCost } from '@/lib/services/costs'
import { CostModelSchema, UpdatePortfolioSchema } from '@/lib/schemas/portfolio'
import { diffForAudit } from '@/lib/services/audit'
import { buildWhatIf, emptyWhatIfForm } from '@/components/analytics/what-if-tool'
import type { RebalanceInputs } from '@/lib/hooks/use-analytics'

// 4.6 — trade history on the transactions page, configurable costs, and the
// what-if tool's form. Synthetic figures only: the repository is public.

const tx = (type: RawTransaction['type'], quantity: number, price: number, executed_at: string, currency = 'MXN', fees = 0): RawTransaction => ({
  type, quantity, price, fees, currency, executed_at,
})

describe('summariseBookHistory', () => {
  const positions = [
    { id: 'p1', symbol: 'AAA', currency: 'MXN' }, // cost in pesos, quote in dollars
    { id: 'p2', symbol: 'BBB', currency: 'USD' },
    { id: 'p3', symbol: 'CCC', currency: 'USD' }, // no quote today
  ]
  const txns = new Map<string, RawTransaction[]>([
    ['p1', [tx('buy', 10, 1800, '2025-01-02')]], // 18,000 MXN for 10 units
    ['p2', [tx('buy', 5, 100, '2025-01-02', 'USD'), tx('sell', 2, 120, '2025-06-01', 'USD')]],
    ['p3', [tx('buy', 1, 50, '2025-01-02', 'USD')]],
  ])
  const quotes = { AAA: 100, BBB: 110 } // AAA quotes 100 USD
  const quoteCurrency = { AAA: 'USD', BBB: 'USD', CCC: 'USD' }
  // 1 USD = 20 MXN today.
  const toCost = (_symbol: string, cost: string) => ({ factor: cost === 'MXN' ? 20 : 1, converted: true })

  const result = summariseBookHistory(positions, txns, quotes, quoteCurrency, toCost)
  const bySymbol = Object.fromEntries(result.positions.map((p) => [p.symbol, p]))

  it('converts the quote into the currency the cost was recorded in', () => {
    // 10 × 100 USD × 20 = 20,000 MXN against an 18,000 MXN cost: +2,000 —
    // not 1,000 − 18,000 = −17,000, which is what subtracting across units gave.
    expect(bySymbol.AAA.marketValue).toBeCloseTo(20_000, 2)
    expect(bySymbol.AAA.unrealizedPnl).toBeCloseTo(2_000, 2)
    expect(bySymbol.AAA.currency).toBe('MXN')
    expect(bySymbol.AAA.price_currency).toBe('USD')
  })

  it('keeps realised and unrealised apart', () => {
    // Sold 2 bought at 100 for 120: +40 banked. 3 left worth 110: +30 on paper.
    expect(bySymbol.BBB.realizedPnl).toBeCloseTo(40, 2)
    expect(bySymbol.BBB.unrealizedPnl).toBeCloseTo(30, 2)
  })

  it('values a position with no quote at cost, and flags it', () => {
    expect(bySymbol.CCC.priced).toBe(false)
    expect(bySymbol.CCC.unrealizedPnl).toBeCloseTo(0, 2)
    expect(bySymbol.CCC.marketValue).toBeCloseTo(50, 2)
  })

  it('totals per currency instead of adding pesos to dollars', () => {
    const totals = Object.fromEntries(result.totals.map((t) => [t.currency, t]))
    expect(Object.keys(totals).sort()).toEqual(['MXN', 'USD'])
    expect(totals.MXN.unrealizedPnl).toBeCloseTo(2_000, 2)
    expect(totals.USD.realizedPnl).toBeCloseTo(40, 2)
    expect(totals.USD.unrealizedPnl).toBeCloseTo(30, 2)
  })

  it('says when a quote could not be converted', () => {
    const r = summariseBookHistory([positions[0]], txns, quotes, quoteCurrency, () => ({ factor: 1, converted: false }))
    expect(r.positions[0].unconverted).toBe(true)
  })
})

describe('portfolio cost model', () => {
  const stated = { commissionPct: 0.25, spreadPct: 0.05, custodyAnnualPct: 0.1, capitalGainsTaxPct: 10, source: 'Tarifario de prueba' }

  it('reads a stored model, and refuses to fill any gap with a guess', () => {
    expect(costModelFrom(stated)).toMatchObject(stated)
    expect(costModelFrom(null)).toBeNull()
    expect(costModelFrom({ ...stated, spreadPct: undefined })).toBeNull()
    expect(costModelFrom({ ...stated, commissionPct: -1 })).toBeNull()
    expect(costModelFrom({ ...stated, source: '  ' })).toBeNull()
  })

  it('treats a model that charges nothing as not configured', () => {
    expect(isCostModelConfigured(costModelFrom(stated))).toBe(true)
    expect(isCostModelConfigured({ commissionPct: 0, spreadPct: 0, custodyAnnualPct: 0, capitalGainsTaxPct: 0, source: 'x' })).toBe(false)
    expect(isCostModelConfigured(null)).toBe(false)
  })

  it('requires a source and sane bounds, and lets the model be cleared', () => {
    expect(CostModelSchema.safeParse({ ...stated, source: '' }).success).toBe(false)
    expect(CostModelSchema.safeParse({ ...stated, commissionPct: 50 }).success).toBe(false)
    expect(UpdatePortfolioSchema.safeParse({ cost_model: null }).success).toBe(true)
    expect(UpdatePortfolioSchema.safeParse({ cost_model: stated }).success).toBe(true)
  })

  it('prices a rebalance on the stated costs', () => {
    // 10,000 sold and 10,000 bought at 0.30% all-in: 60 of costs, 10,000 turnover.
    const cost = rebalanceCost([-10_000, 10_000], costModelFrom(stated)!, 100_000)
    expect(cost.turnover).toBe(10_000)
    expect(cost.total).toBeCloseTo(60, 2)
    expect(cost.pctOfPortfolio).toBeCloseTo(0.06, 4)
  })

  it('shows a changed cost model in the audit trail', () => {
    // String() made every object "[object Object]", so a change compared equal.
    expect(diffForAudit({ cost_model: stated }, { cost_model: { ...stated, spreadPct: 0.1 } }, ['cost_model'])).toHaveLength(1)
    expect(diffForAudit({ cost_model: stated }, { cost_model: { ...stated } }, ['cost_model'])).toHaveLength(0)
  })
})

describe('what-if form', () => {
  const inputs = {
    currency: 'MXN',
    book_value: 100_000,
    holdings: [
      { symbol: 'A', value: 60_000, weight: 0.6, sector: null },
      { symbol: 'B', value: 40_000, weight: 0.4, sector: null },
    ],
    cov: [[0.04, 0.01], [0.01, 0.02]],
    expected_returns: [0.08, 0.05],
    risk_free_rate: 0.03,
    asset_betas: null,
    benchmark: { symbol: 'SPY', name: 'S&P 500' },
    window: { from: '2025-01-01', to: '2026-01-01' },
    targets: { equal: { A: 0.5, B: 0.5 }, drift: null, riskParity: { A: 0.4, B: 0.6 } },
    unconverted: [],
  } as RebalanceInputs

  it('changes nothing until something is changed', () => {
    const built = buildWhatIf(inputs, emptyWhatIfForm(inputs))
    expect('error' in built).toBe(false)
    if (!('error' in built)) expect(built.change).toEqual({})
  })

  it('turns a rebalancing preset into target weights', () => {
    const built = buildWhatIf(inputs, { ...emptyWhatIfForm(inputs), preset: 'riskParity' })
    if ('error' in built) throw new Error(built.error)
    expect(built.change.weights).toEqual({ A: 0.4, B: 0.6 })
  })

  it('says why hand-set weights are not a portfolio', () => {
    const built = buildWhatIf(inputs, { ...emptyWhatIfForm(inputs), preset: 'custom', custom: { A: '70', B: '20' } })
    expect(built).toEqual({ error: 'Los pesos suman 90.0%; deben sumar 100%.' })
  })

  it('will not remove every position', () => {
    const built = buildWhatIf(inputs, { ...emptyWhatIfForm(inputs), removed: ['A', 'B'] })
    expect('error' in built && built.error).toMatch(/al menos una/)
  })

  it('measures plan changes only against a goal, and simulates the longer horizon', () => {
    expect('error' in buildWhatIf(inputs, { ...emptyWhatIfForm(inputs), newContribution: '5000' })).toBe(true)
    const built = buildWhatIf(inputs, {
      ...emptyWhatIfForm(inputs),
      goalContribution: '3000', goalYears: '10', goalTarget: '900000',
      newYears: '15',
    })
    if ('error' in built) throw new Error(built.error)
    expect(built.scenario.plan).toEqual({ aportacionMensual: 3000, años: 10, meta: 900000 })
    expect(built.change.años).toBe(15)
    expect(built.years).toBe(15)
  })
})
