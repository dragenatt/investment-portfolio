import { describe, it, expect } from 'vitest'
import {
  compareScenarios,
  parseScenarioRequest,
  DEFAULT_SCENARIO_IDS,
  type Scenario,
} from '@/lib/services/scenario-comparison'
import { portfolioVolatility } from '@/lib/services/risk-attribution'
import { calculateCovarianceMatrix } from '@/lib/services/covariance'
import { mulberry32, standardNormal } from '@/lib/utils/random'

const TRADING_DAYS = 252

/** Daily returns with a shared market component, so the assets correlate. */
function syntheticHistory(days = 260) {
  const random = mulberry32(2026)
  const specs = [
    { drift: 0.12, vol: 0.35, beta: 1.2 }, // volatile growth
    { drift: 0.07, vol: 0.16, beta: 0.9 }, // broad index
    { drift: 0.04, vol: 0.05, beta: 0.1 }, // calm
  ]
  const series = specs.map(() => [] as number[])
  for (let t = 0; t < days; t++) {
    const market = standardNormal(random)
    for (let i = 0; i < specs.length; i++) {
      const { drift, vol, beta } = specs[i]
      const own = standardNormal(random)
      const mix = (beta * market + own) / Math.sqrt(beta * beta + 1)
      series[i].push(drift / TRADING_DAYS + (vol / Math.sqrt(TRADING_DAYS)) * mix)
    }
  }
  return series
}

const symbols = ['GROW', 'INDX', 'CALM']
const returnsMatrix = syntheticHistory()
const scenarios: Scenario[] = [
  { id: 'current', name: 'Tu cartera actual', weights: [0.6, 0.3, 0.1] },
  { id: 'equalWeight', name: 'Pesos iguales', weights: [1 / 3, 1 / 3, 1 / 3] },
  { id: 'calm', name: 'Todo en lo tranquilo', weights: [0, 0, 1] },
]
const base = {
  symbols,
  returnsMatrix,
  scenarios,
  riskFreeRate: 0.04,
  horizonYears: 1,
  numSimulations: 600,
  seed: 7,
}

describe('compareScenarios', () => {
  const result = compareScenarios(base)!

  it('returns one set of metrics per scenario, in the order given', () => {
    expect(result.scenarios.map((s) => s.id)).toEqual(['current', 'equalWeight', 'calm'])
    expect(result.baselineId).toBe('current')
  })

  it('needs at least two scenarios to compare', () => {
    expect(compareScenarios({ ...base, scenarios: [scenarios[0]] })).toBeNull()
  })

  it('gives every scenario the seven metrics E2 names', () => {
    for (const s of result.scenarios) {
      // riesgo, retorno, Sharpe, VaR, drawdown, probabilidad, concentracion
      expect(Number.isFinite(s.volatilityPct)).toBe(true)
      expect(Number.isFinite(s.expectedReturnPct)).toBe(true)
      expect(s.sharpe === null || Number.isFinite(s.sharpe)).toBe(true)
      expect(Number.isFinite(s.var95Pct)).toBe(true)
      expect(Number.isFinite(s.maxDrawdownMedianPct)).toBe(true)
      expect(Number.isFinite(s.maxDrawdownBadPct)).toBe(true)
      expect(Number.isFinite(s.probabilityOfLoss)).toBe(true)
      expect(Number.isFinite(s.hhi)).toBe(true)
    }
  })

  it('keeps every probability between 0 and 1', () => {
    for (const s of result.scenarios) {
      for (const p of [s.probabilityOfLoss, s.probabilityBeatRiskFree]) {
        expect(p).toBeGreaterThanOrEqual(0)
        expect(p).toBeLessThanOrEqual(1)
      }
    }
  })

  it('normalises weights to 100%', () => {
    for (const s of result.scenarios) {
      const total = s.weights.reduce((sum, w) => sum + w.weight, 0)
      expect(total).toBeCloseTo(1, 10)
    }
  })

  it('reports volatility as sqrt(w Sigma w) on the annualised covariance', () => {
    const cov = calculateCovarianceMatrix(returnsMatrix).map((row) => row.map((v) => v * TRADING_DAYS))
    for (const s of result.scenarios) {
      const expected = portfolioVolatility(s.weights.map((w) => w.weight), cov)! * 100
      expect(s.volatilityPct).toBeCloseTo(expected, 8)
    }
  })

  it('runs every scenario through the same simulated futures', () => {
    // A scenario identical to the baseline must come out identical in every
    // simulated metric. With a separate draw per scenario it would not.
    const twin = compareScenarios({
      ...base,
      scenarios: [scenarios[0], { id: 'twin', name: 'Gemela', weights: [0.6, 0.3, 0.1] }],
    })!
    const [a, b] = twin.scenarios
    expect(b.var95Pct).toBe(a.var95Pct)
    expect(b.maxDrawdownMedianPct).toBe(a.maxDrawdownMedianPct)
    expect(b.probabilityOfLoss).toBe(a.probabilityOfLoss)
    expect(b.medianAnnualReturnPct).toBe(a.medianAnnualReturnPct)
  })

  it('shows less drawdown and less VaR for the calmer allocation', () => {
    const current = result.scenarios.find((s) => s.id === 'current')!
    const calm = result.scenarios.find((s) => s.id === 'calm')!
    expect(calm.volatilityPct).toBeLessThan(current.volatilityPct)
    expect(calm.maxDrawdownMedianPct).toBeLessThan(current.maxDrawdownMedianPct)
    expect(calm.var95Pct).toBeLessThan(current.var95Pct)
  })

  it('measures concentration with HHI and its effective number of holdings', () => {
    const equal = result.scenarios.find((s) => s.id === 'equalWeight')!
    expect(equal.hhi).toBeCloseTo(1 / 3, 10)
    expect(equal.effectiveHoldings).toBeCloseTo(3, 8)
    const calm = result.scenarios.find((s) => s.id === 'calm')!
    expect(calm.hhi).toBeCloseTo(1, 10)
    expect(calm.largestWeight.symbol).toBe('CALM')
  })

  it('names where the risk actually comes from', () => {
    const current = result.scenarios.find((s) => s.id === 'current')!
    // 60% in the most volatile asset: it should carry most of the risk.
    expect(current.largestRiskShare.symbol).toBe('GROW')
    expect(current.largestRiskShare.pct).toBeGreaterThan(60)
  })

  it('is deterministic', () => {
    expect(compareScenarios(base)).toEqual(compareScenarios(base))
  })

  it('sets aside a scenario with invalid weights and says why', () => {
    const withBad = compareScenarios({
      ...base,
      scenarios: [
        ...scenarios,
        { id: 'short', name: 'En corto', weights: [1.5, -0.5, 0] },
        { id: 'wrong', name: 'Mal tamano', weights: [1, 0] },
      ],
    })!
    expect(withBad.scenarios.map((s) => s.id)).toEqual(['current', 'equalWeight', 'calm'])
    expect(withBad.rejected.map((r) => r.id)).toEqual(['short', 'wrong'])
    for (const r of withBad.rejected) expect(r.reason.length).toBeGreaterThan(10)
  })

  it('refuses a history too short to estimate anything', () => {
    expect(compareScenarios({ ...base, returnsMatrix: returnsMatrix.map((r) => r.slice(0, 5)) })).toBeNull()
  })

  it('says every scenario lived the same futures and the returns are estimates', () => {
    expect(result.caveat).toMatch(/mismos/i)
    expect(result.caveat).toMatch(/estimad|estimación/i)
    expect(result.caveat).toMatch(/no es una recomendacion/i)
  })
})

describe('explaining the differences', () => {
  const result = compareScenarios(base)!

  it('explains every scenario against the baseline, not the baseline against itself', () => {
    expect(result.explanations.map((e) => e.scenarioId)).toEqual(['equalWeight', 'calm'])
    for (const e of result.explanations) expect(e.versusId).toBe('current')
  })

  it('names the biggest weight moves by symbol, with numbers', () => {
    const calm = result.explanations.find((e) => e.scenarioId === 'calm')!
    const text = [calm.headline, ...calm.reasons].join(' ')
    expect(text).toMatch(/GROW/)
    expect(text).toMatch(/CALM/)
    expect(text).toMatch(/\d+ pp/)
  })

  it('quotes both volatilities in the headline', () => {
    const calm = result.explanations.find((e) => e.scenarioId === 'calm')!
    const current = result.scenarios.find((s) => s.id === 'current')!
    const other = result.scenarios.find((s) => s.id === 'calm')!
    expect(calm.headline).toContain(current.volatilityPct.toFixed(1))
    expect(calm.headline).toContain(other.volatilityPct.toFixed(1))
  })

  it('covers risk, return, Sharpe, drawdown and VaR, probability and concentration', () => {
    const equal = result.explanations.find((e) => e.scenarioId === 'equalWeight')!
    const text = equal.reasons.join(' ').toLowerCase()
    expect(text).toMatch(/riesgo/)
    expect(text).toMatch(/rendimiento/)
    expect(text).toMatch(/sharpe/)
    expect(text).toMatch(/caida/)
    expect(text).toMatch(/var/)
    expect(text).toMatch(/pérdida/)
    expect(text).toMatch(/concentracion|posiciones/)
  })

  it('says so when a scenario is the same allocation as the baseline', () => {
    const twin = compareScenarios({
      ...base,
      scenarios: [scenarios[0], { id: 'twin', name: 'Gemela', weights: [0.6, 0.3, 0.1] }],
    })!
    expect(twin.explanations[0].headline).toMatch(/misma asignación/i)
  })

  it("does not claim the baseline's riskiest holding explains a move it cannot explain", () => {
    // Found on a real book: "^IXIC aporta 54% del riesgo; en Pesos iguales aporta
    // 11%. Por eso la volatilidad SUBE." Its share fell, so it cannot be why the
    // volatility rose — a holding that was added carried that. The sentence must
    // name the riskiest holding on each side instead of asserting a cause.
    const history = syntheticHistory()
    const result = compareScenarios({
      ...base,
      returnsMatrix: history,
      // Baseline mostly in the index; the alternative adds the volatile asset.
      scenarios: [
        { id: 'current', name: 'Actual', weights: [0, 0.8, 0.2] },
        { id: 'grow', name: 'Con crecimiento', weights: [0.5, 0.4, 0.1] },
      ],
    })!
    const risk = result.explanations[0].reasons.find((r) => r.startsWith('Riesgo'))!
    expect(risk).not.toMatch(/por eso/i)
    expect(risk).toMatch(/INDX/)
    expect(risk).toMatch(/GROW/)
  })

  it('writes the VaR comparison as one readable sentence', () => {
    for (const e of result.explanations) {
      const text = e.reasons.join(' ')
      expect(text).not.toMatch(/frente a sigue siendo|frente a es una/)
    }
  })

  it('never writes NaN, Infinity or undefined into the text', () => {
    for (const e of result.explanations) {
      expect([e.headline, ...e.reasons].join(' ')).not.toMatch(/NaN|Infinity|undefined/)
    }
  })
})

describe('parseScenarioRequest', () => {
  const symbols = ['AAPL', 'MSFT', 'VOO']
  const parse = (query: string) => parseScenarioRequest(new URLSearchParams(query), symbols)

  it('defaults to a one-year horizon and the standard set', () => {
    const request = parse('')
    expect(request.horizonYears).toBe(1)
    expect(request.include).toEqual(DEFAULT_SCENARIO_IDS)
    expect(request.custom).toBeNull()
  })

  it('accepts only the horizons it offers', () => {
    expect(parse('horizon=5').horizonYears).toBe(5)
    expect(parse('horizon=7').horizonYears).toBe(1)
    expect(parse('horizon=abc').horizonYears).toBe(1)
  })

  it('keeps only known scenario ids, without duplicates, in the order asked', () => {
    expect(parse('include=riskParity,current,bogus,current').include).toEqual(['riskParity', 'current'])
  })

  it('reads custom weights by symbol and fills the rest with zero', () => {
    const request = parse('custom=VOO:70,AAPL:30')
    expect(request.custom).toEqual([30, 0, 70])
    expect(request.include).toContain('custom')
  })

  it('refuses custom weights for a symbol the book does not hold', () => {
    const request = parse('custom=TSLA:50,AAPL:50')
    expect(request.custom).toBeNull()
    expect(request.errors.join(' ')).toMatch(/TSLA/)
  })

  it('refuses a negative or non-numeric custom weight', () => {
    expect(parse('custom=AAPL:-10,MSFT:110').custom).toBeNull()
    expect(parse('custom=AAPL:abc').custom).toBeNull()
  })
})
