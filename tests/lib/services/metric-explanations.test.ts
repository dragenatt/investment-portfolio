import { describe, it, expect } from 'vitest'
import {
  explainMetric,
  METRIC_IDS,
  type MetricId,
} from '@/lib/services/metric-explanations'
import { calculateVolatility, calculateMaxDrawdown } from '@/lib/services/analytics'
import { historicalVaR, conditionalVaR } from '@/lib/services/var'
import { calculateXIRR } from '@/lib/services/returns'
import { effectiveIndependentBets } from '@/lib/services/pca'

describe('explainMetric — every metric', () => {
  it('covers every metric the roadmap names', () => {
    for (const id of [
      'return',
      'volatility',
      'sharpe',
      'sortino',
      'beta',
      'alpha',
      'var',
      'cvar',
      'maxDrawdown',
      'trackingError',
      'informationRatio',
      'hhi',
      'effectiveBets',
      'xirr',
      'twr',
    ] as MetricId[]) {
      expect(METRIC_IDS).toContain(id)
    }
  })

  it('gives every metric a name, a formula and a definition', () => {
    for (const id of METRIC_IDS) {
      const explanation = explainMetric(id, 1)!
      expect(explanation.name.length).toBeGreaterThan(2)
      expect(explanation.formula.length).toBeGreaterThan(3)
      expect(explanation.definition.length).toBeGreaterThan(30)
    }
  })

  it('never returns a generic definition in place of the reading', () => {
    // The roadmap is explicit: not just definitions, the user's own number. The
    // property is that the reading DEPENDS on the value — each metric rounds to
    // whatever precision suits it, so asserting a literal string would be
    // testing the formatter rather than the requirement.
    for (const id of METRIC_IDS) {
      const low = explainMetric(id, 0.4)!.interpretation
      const high = explainMetric(id, 14.7)!.interpretation
      expect(low).not.toBe(high)
      expect(low).not.toBe(explainMetric(id, 0.4)!.definition)
    }
  })

  it('renders the value itself into the reading', () => {
    expect(explainMetric('sharpe', 0.82)!.interpretation).toContain('0.82')
    expect(explainMetric('volatility', 18.4)!.interpretation).toContain('18.40')
    expect(explainMetric('hhi', 0.123)!.interpretation).toContain('0.123')
  })

  it('returns null for a metric it does not know', () => {
    expect(explainMetric('nonsense' as MetricId, 1)).toBeNull()
  })

  it('says so rather than guessing when the value is missing', () => {
    const explanation = explainMetric('sharpe', null)!
    expect(explanation.interpretation).toMatch(/no|sin/i)
    expect(explanation.interpretation).not.toMatch(/NaN|undefined|null/)
  })
})

describe('explainMetric — readings that depend on the number', () => {
  it('reads a negative Sharpe differently from a strong one', () => {
    const bad = explainMetric('sharpe', -0.4)!.interpretation
    const good = explainMetric('sharpe', 1.6)!.interpretation
    expect(bad).not.toBe(good)
    expect(bad).toMatch(/menos|peor|libre de riesgo|negativ/i)
  })

  it('reads a beta above and below 1 in opposite directions', () => {
    expect(explainMetric('beta', 1.6)!.interpretation).toMatch(/amplific|m[aá]s/i)
    expect(explainMetric('beta', 0.4)!.interpretation).toMatch(/amortigua|menos/i)
  })

  it('reads HHI as an equivalent number of positions, against how many are held', () => {
    const reading = explainMetric('hhi', 0.37, { holdings: 7 })!.interpretation
    expect(reading).toContain('2.7')
    expect(reading).toMatch(/7 posiciones/)
    expect(explainMetric('hhi', 0.65)!.interpretation).toMatch(/concentr/i)
  })

  it('states the recovery a drawdown needs, computed from the value given', () => {
    // -50% needs +100% back
    expect(explainMetric('maxDrawdown', 50)!.interpretation).toMatch(/100/)
  })

  it('reads alpha as skill only after paying for beta', () => {
    expect(explainMetric('alpha', 3.2)!.definition).toMatch(/beta/i)
  })

  it('distinguishes TWR from XIRR in their own definitions', () => {
    expect(explainMetric('twr', 12)!.definition).toMatch(/aportacion|flujo|estrategia/i)
    expect(explainMetric('xirr', 12)!.definition).toMatch(/momento|cuando|timing/i)
  })
})

describe('explainMetric — context', () => {
  it('names the benchmark when one is given', () => {
    const explanation = explainMetric('beta', 1.2, { benchmarkName: 'IPC' })!
    expect(explanation.interpretation).toContain('IPC')
  })

  it('works without any context at all', () => {
    expect(explainMetric('beta', 1.2)!.interpretation.length).toBeGreaterThan(20)
  })

  it('puts a VaR in money when the portfolio value is known', () => {
    const explanation = explainMetric('var', 2.5, { portfolioValue: 100000 })!
    expect(explanation.interpretation).toMatch(/2,?500|2500/)
  })

  it('leaves VaR as a percentage when the value is unknown', () => {
    const explanation = explainMetric('var', 2.5)!
    expect(explanation.interpretation).toMatch(/2\.5|2,5/)
  })
})

describe('explainMetric — safety', () => {
  it('never emits NaN or Infinity into the text', () => {
    for (const id of METRIC_IDS) {
      for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
        const explanation = explainMetric(id, value)!
        expect(explanation.interpretation).not.toMatch(/NaN|Infinity/)
      }
    }
  })

  it('is deterministic', () => {
    expect(explainMetric('sharpe', 0.82)).toEqual(explainMetric('sharpe', 0.82))
  })
})

// ─── E3: definition, formula, interpretation, example, the user's own result ──

describe('E3 — every metric carries all five parts', () => {
  it('has a worked example with a setup, the arithmetic and the result', () => {
    for (const id of METRIC_IDS) {
      const { example } = explainMetric(id, 1)!
      expect(example.setup.length, id).toBeGreaterThan(15)
      expect(example.steps.length, id).toBeGreaterThan(5)
      expect(example.result.length, id).toBeGreaterThan(2)
      expect(Number.isFinite(example.value), id).toBe(true)
    }
  })

  it("carries the user's own value and its display beside the explanation", () => {
    const explanation = explainMetric('volatility', 18.2)!
    expect(explanation.value).toBe(18.2)
    expect(explanation.display).toBe('18.20%')
    const missing = explainMetric('volatility', null)!
    expect(missing.value).toBeNull()
    expect(missing.display).toBe('—')
  })

  it('never shows an example number in a text that disagrees with its value', () => {
    for (const id of METRIC_IDS) {
      const { example } = explainMetric(id, 1)!
      expect(example.result, id).toContain(example.display)
    }
  })
})

describe('E3 — worked examples come from the real engines', () => {
  // A hand-typed example is right on the day it is written. These are computed
  // by the same functions the app uses, and these tests recompute them.
  const ex = (id: MetricId) => explainMetric(id, 1)!.example

  it('volatility, including the daily figure quoted in the steps', () => {
    const daily = [0.012, -0.008, 0.005, -0.015, 0.009, 0.003, -0.004, 0.011, -0.007, 0.002]
    expect(ex('volatility').value).toBeCloseTo(calculateVolatility(daily) * 100, 10)
    // The steps once said 0.87% by hand; the sample standard deviation is 0.90%.
    const dailyPct = ((calculateVolatility(daily) / Math.sqrt(252)) * 100).toFixed(2)
    expect(ex('volatility').steps).toContain(`${dailyPct}% diario`)
  })

  it('max drawdown', () => {
    expect(ex('maxDrawdown').value).toBeCloseTo(calculateMaxDrawdown([100, 130, 91, 120]), 10)
  })

  it('VaR and CVaR on the same twenty days', () => {
    const days = [1.2, -0.4, 0.8, -2.9, 0.3, -1.1, 0.6, -0.2, 1.5, -3.6, 0.9, -0.7, 0.4, -1.8, 0.1, 0.7, -0.9, 1.1, -0.3, 0.5].map((v) => v / 100)
    expect(ex('var').value).toBeCloseTo(historicalVaR(days, 95)! * 100, 10)
    expect(ex('cvar').value).toBeCloseTo(conditionalVaR(days, 95)! * 100, 10)
    expect(ex('cvar').value).toBeGreaterThanOrEqual(ex('var').value)
  })

  it('XIRR', () => {
    const flows = [
      { date: '2025-01-01', amount: -10000 },
      { date: '2025-07-01', amount: -5000 },
      { date: '2026-01-01', amount: 16200 },
    ]
    expect(ex('xirr').value).toBeCloseTo(calculateXIRR(flows)!, 8)
  })

  it('effective independent bets', () => {
    const cov = [
      [0.04, 0.036, 0],
      [0.036, 0.04, 0],
      [0, 0, 0.04],
    ]
    expect(ex('effectiveBets').value).toBeCloseTo(effectiveIndependentBets(cov)!, 10)
  })

  it('the arithmetic ones add up', () => {
    expect(ex('return').value).toBeCloseTo(12, 10)
    expect(ex('sharpe').value).toBeCloseTo((10 - 4) / 15, 10)
    expect(ex('sortino').value).toBeCloseTo((10 - 4) / 8, 10)
    expect(ex('beta').value).toBeCloseTo(0.0002 / 0.00016, 10)
    expect(ex('alpha').value).toBeCloseTo(14 - 1.2 * 10, 10)
    expect(ex('trackingError').value).toBeCloseTo(0.4 * Math.sqrt(252), 10)
    expect(ex('informationRatio').value).toBeCloseTo(2 / (0.4 * Math.sqrt(252)), 10)
    expect(ex('hhi').value).toBeCloseTo(0.5 ** 2 + 0.3 ** 2 + 0.2 ** 2, 10)
    expect(ex('twr').value).toBeCloseTo((1.1 * 0.95 - 1) * 100, 10)
  })
})

describe('E3 — the explanation matches what the app actually computes', () => {
  it('states alpha the way the risk tab computes it, with no risk-free rate', () => {
    // The risk route calls calculateBetaAlpha with a risk-free rate of 0, so the
    // number on screen is Rp - beta x Rb. Showing Jensen's formula beside it
    // described a calculation that did not happen.
    const plain = explainMetric('alpha', 2)!
    expect(plain.formula).toMatch(/Rp - beta x Rb/)
    expect(plain.formula).not.toMatch(/Rf/)
    const jensen = explainMetric('alpha', 2, { alphaRiskFreePct: 4 })!
    expect(jensen.formula).toMatch(/Rf/)
  })

  it('annualises volatility by periods per year, not by a hardcoded 252', () => {
    expect(explainMetric('volatility', 18)!.formula).toMatch(/periodos por ano/)
    expect(explainMetric('volatility', 18, { periodsPerYear: 52 })!.interpretation).toMatch(/semanal|52/)
  })

  it('gives the actual entropy formula for effective bets', () => {
    const { formula } = explainMetric('effectiveBets', 2)!
    expect(formula).toMatch(/exp/)
    expect(formula).toMatch(/ln/)
  })

  it('names the bar the VaR is measured over', () => {
    expect(explainMetric('var', 2.5, { periodsPerYear: 52 })!.interpretation).toMatch(/semanas/)
    expect(explainMetric('var', 2.5)!.interpretation).toMatch(/dias/)
  })

  it('does not grade a Sharpe ratio with unsourced bands', () => {
    // "Below 0.5 is low, above 1 is high" has no source; the roadmap forbids
    // financial judgements without one. The reading is literal instead.
    for (const value of [0.3, 0.8, 1.6]) {
      expect(explainMetric('sharpe', value)!.interpretation).not.toMatch(/\b(bajo|razonable|alto)\b/)
    }
  })

  it('gives a Sharpe ratio its sampling uncertainty when the history length is known', () => {
    // Lo (2002): SE of an annualised Sharpe from T bars at q per year is
    // sqrt((q + SR^2 / 2) / T). Six months of daily data leaves it enormous.
    const sr = 1.74
    const se = Math.sqrt((252 + (sr * sr) / 2) / 126)
    const reading = explainMetric('sharpe', sr, { observations: 126, periodsPerYear: 252 })!.interpretation
    expect(reading).toContain((sr - 1.96 * se).toFixed(2))
    expect(reading).toContain((sr + 1.96 * se).toFixed(2))
    expect(reading).toMatch(/Lo/)
  })

  it('does not grade tracking error or the information ratio with bands either', () => {
    for (const value of [1, 5, 12]) {
      expect(explainMetric('trackingError', value)!.interpretation).not.toMatch(/\b(bajo|moderado|alto)\b/)
    }
    expect(explainMetric('informationRatio', 0.7)!.interpretation).not.toMatch(/\bbueno\b/)
  })

  it('cites a source for the metrics that come from a named paper', () => {
    for (const id of ['sharpe', 'sortino', 'alpha', 'cvar', 'effectiveBets'] as MetricId[]) {
      expect(explainMetric(id, 1)!.source, id).toMatch(/\(\d{4}\)/)
    }
  })
})

describe('E3 — readings found wanting on a real book', () => {
  it('warns that an annual XIRR on money invested for months is an extrapolation', () => {
    // Seen on a real book: simple return 0.52%, XIRR 18.55% "a year", with most
    // of the money deposited weeks earlier. Annualising weeks multiplies them.
    const young = explainMetric('xirr', 18.55, { capitalAgeDays: 45 })!.interpretation
    expect(young).toMatch(/45 dias/)
    expect(young).toMatch(/extrapola/)
    const mature = explainMetric('xirr', 8, { capitalAgeDays: 800 })!.interpretation
    expect(mature).not.toMatch(/extrapola/)
  })

  it("reads Sortino against the user's own Sharpe when it is known", () => {
    const reading = explainMetric('sortino', 2.78, { sharpe: 1.7 })!.interpretation
    expect(reading).toContain('1.70')
    expect(reading).toMatch(/1\.6\d? veces/)
  })

  it('reads effective bets as a sentence about the positions held', () => {
    const reading = explainMetric('effectiveBets', 2.8, { holdings: 7 })!.interpretation
    expect(reading).not.toMatch(/^Tu 2\.8 de 7/)
    expect(reading).toMatch(/7 posiciones/)
    expect(reading).toContain('2.8')
  })
})
