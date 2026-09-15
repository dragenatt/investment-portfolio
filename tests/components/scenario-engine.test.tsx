import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { ScenarioEngineData } from '@/lib/hooks/use-analytics'
import { runScenario, estimateReliability, parsePortfolioScenarioRequest, type ScenarioResult } from '@/lib/services/scenario-engine'
import { mulberry32, standardNormal } from '@/lib/utils/random'

const calls: string[] = []
const state: { data?: ScenarioEngineData; isLoading: boolean } = { isLoading: false }
vi.mock('@/lib/hooks/use-analytics', () => ({
  useScenarioEngine: (_pid: string, query: string) => {
    calls.push(query)
    return { ...state, error: undefined, mutate: vi.fn() }
  },
}))

import { ScenarioEngineCard, scenarioQuery } from '@/components/analytics/scenario-engine'

function sample(expected: string): ScenarioEngineData {
  const result = runScenario({
    capital: 10_000,
    holdings: [{ symbol: 'AAA', weight: 1 }],
    contributions: { monthly: 100 },
    horizonMonths: 24,
    risk: { expectedReturns: [0.06], volatilities: [0.15], correlation: [[1]], source: 'Media y covarianza históricas de los rendimientos diarios' },
    simulations: 200,
  }) as ScenarioResult
  const random = mulberry32(5)
  return {
    request: parsePortfolioScenarioRequest(new URLSearchParams(`expected=${expected}`)),
    allocation: { preset: 'current', name: 'Pesos actuales', weights: [{ symbol: 'AAA', weight: 1 }] },
    capital: 10_000,
    benchmark: null,
    result,
    estimates: estimateReliability(Array.from({ length: 120 }, () => 0.002 + standardNormal(random) * 0.012)),
    window: { from: '2026-03-01', to: '2026-09-14' },
  }
}

describe('ScenarioEngineCard', () => {
  it('shows the projection with its reproducibility key and warns when the historical mean is unreliable', () => {
    state.data = sample('')
    render(<ScenarioEngineCard pid="p1" currency="USD" />)
    expect(screen.getByText('Motor de escenarios')).toBeInTheDocument()
    expect(screen.getByRole('note')).toHaveTextContent('Considera indicar un rendimiento esperado')
    expect(screen.getByText(state.data.result!.model.key)).toBeInTheDocument()
    expect(screen.getByText(String(state.data.result!.model.seed))).toBeInTheDocument()
    expect(screen.getByText(/Sin costos indicados: las cifras son brutas/)).toBeInTheDocument()
  })

  it('does not warn once an expected return has been given', () => {
    state.data = sample('6')
    render(<ScenarioEngineCard pid="p1" currency="USD" />)
    expect(screen.queryByRole('note')).toBeNull()
  })

  it('sends every field of the form when simulating, only on submit', () => {
    state.data = sample('')
    calls.length = 0
    render(<ScenarioEngineCard pid="p1" currency="USD" />)
    fireEvent.change(screen.getByLabelText('Aportación mensual'), { target: { value: '500' } })
    fireEvent.change(screen.getByLabelText('Choque: caída de todas las posiciones (%)'), { target: { value: '30' } })
    fireEvent.change(screen.getByLabelText('Pesos'), { target: { value: 'riskParity' } })
    expect(calls.at(-1)).toContain('monthly=0')
    fireEvent.click(screen.getByRole('button', { name: 'Simular escenario' }))
    const query = new URLSearchParams(calls.at(-1))
    expect(query.get('monthly')).toBe('500')
    expect(query.get('shock')).toBe('-30')
    expect(query.get('allocation')).toBe('riskParity')
    expect(query.get('horizon')).toBe('60')
  })

  it('builds the same query from the same form', () => {
    const form = { allocation: 'current', expected: '', horizonYears: '10', monthly: '0', rebalance: 'annual', inflation: '4', custody: '0', commission: '0', shock: '0', shockMonth: '12' }
    expect(scenarioQuery(form)).toBe(scenarioQuery({ ...form }))
    expect(new URLSearchParams(scenarioQuery(form)).get('horizon')).toBe('120')
  })
})
