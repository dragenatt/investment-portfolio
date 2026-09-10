import { describe, it, expect } from 'vitest'
import {
  explainMetric,
  METRIC_IDS,
  type MetricId,
} from '@/lib/services/metric-explanations'

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

  it('warns that a concentrated HHI is concentrated', () => {
    expect(explainMetric('hhi', 0.65)!.interpretation).toMatch(/concentr/i)
    expect(explainMetric('hhi', 0.12)!.interpretation).not.toMatch(/muy concentrad/i)
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
