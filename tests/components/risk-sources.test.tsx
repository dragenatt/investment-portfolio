import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { RiskSourcesData } from '@/lib/hooks/use-analytics'

const state: { data?: RiskSourcesData; error?: Error; isLoading: boolean } = { isLoading: false }
vi.mock('@/lib/hooks/use-analytics', () => ({
  useRiskSources: () => ({ ...state, mutate: vi.fn() }),
}))

import { RiskSources } from '@/components/analytics/risk-sources'

// A payload in the route's shape, with made-up holdings and figures (this repository is public).
const real: RiskSourcesData = {
  observations: 124,
  portfolioVolatilityPct: 18.25,
  byAsset: [
    { symbol: 'IDX1', sector: 'Índices', weightPct: 48.0, volatilityPct: 21.3, correlationWithPortfolio: 0.98, betaToBenchmark: 1.3, percentOfRisk: 55.2 },
    { symbol: 'STK1', sector: 'Acciones (sin sector)', weightPct: 21.0, volatilityPct: 25.1, correlationWithPortfolio: 0.77, betaToBenchmark: 1.1, percentOfRisk: 24.9 },
    { symbol: 'ETF1', sector: 'ETF', weightPct: 31.0, volatilityPct: 14.2, correlationWithPortfolio: 0.91, betaToBenchmark: 1, percentOfRisk: 19.9 },
  ],
  bySector: [
    { sector: 'Índices', weightPct: 50.1, percentOfRisk: 55.3, symbols: ['IDX1', 'IDX2'] },
    { sector: 'Acciones (sin sector)', weightPct: 18.9, percentOfRisk: 24.8, symbols: ['STK1', 'STK2'] },
    { sector: 'ETF', weightPct: 31.0, percentOfRisk: 19.9, symbols: ['ETF1'] },
  ],
  byComponent: {
    effectiveBets: 2.61,
    components: [
      { index: 1, percentOfRisk: 76.4, varianceExplainedPct: 52.3, nearlyTied: false, loadings: [{ symbol: 'STK1', loading: 0.6 }, { symbol: 'IDX1', loading: 0.5 }] },
      { index: 2, percentOfRisk: 2.4, varianceExplainedPct: 25.4, nearlyTied: false, loadings: [{ symbol: 'STK2', loading: -0.7 }] },
    ],
  },
  byFactor: {
    explainedPct: 85.10,
    specificPct: 14.90,
    factors: [
      { id: 'market', name: 'Mercado', exposure: 1.19, significant: true, percentOfRisk: 70.2 },
      { id: 'value', name: 'Valor (baratas menos caras)', exposure: -0.4, significant: true, percentOfRisk: 16.4 },
      { id: 'momentum', name: 'Momentum', exposure: 0.2, significant: true, percentOfRisk: -4.8 },
    ],
  },
  market: { symbol: 'SPY', name: 'S&P 500', beta: 1.1400, correlation: 0.8955, systematicPct: 80.20, specificPct: 19.80 },
  correlation: { averagePairwise: 0.7, highestPair: { a: 'IDX3', b: 'ETF1', correlation: 0.99 } },
  findings: [
    'IDX1 genera el 55% del riesgo con el 48% del dinero.',
    'El S&P 500 explica el 80% de las variaciones del portafolio (beta 1.14); el 20% restante no lo explica el mercado.',
  ],
  window: { from: '2026-03-12', to: '2026-09-14', intervals_used: 124, intervals_available: 127, cadence: '1 dia' },
  excluded_symbols: [],
  omitted: {},
  benchmark: { symbol: 'SPY', name: 'S&P 500' },
}

describe('RiskSources', () => {
  it('answers the question in words before any chart', () => {
    state.data = real
    render(<RiskSources portfolioId="p1" />)
    expect(screen.getByText('¿De dónde viene el riesgo de tu portafolio?')).toBeInTheDocument()
    expect(screen.getByText('IDX1 genera el 55% del riesgo con el 48% del dinero.')).toBeInTheDocument()
    expect(screen.getByText(/no predice el futuro ni es una recomendación/)).toBeInTheDocument()
  })

  it('switches the same risk between lenses, each with its text alternative', () => {
    state.data = real
    const { container } = render(<RiskSources portfolioId="p1" />)
    const caption = () => container.querySelector('figcaption')!.textContent ?? ''

    expect(caption()).toContain('Riesgo por activo: IDX1 55.2%')

    fireEvent.click(screen.getByRole('button', { name: 'Factor' }))
    expect(caption()).toContain('Riesgo por factor: Mercado 70.2%')
    expect(screen.getByRole('button', { name: 'Factor' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'Componente' }))
    expect(caption()).toContain('Componente 1 76.4%')
    expect(screen.getByText(/apuestas independientes/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Mercado' }))
    expect(caption()).toContain('Explicado por S&P 500 80.2%')
  })

  it('disables a lens the data does not have, and says why a view is missing', () => {
    state.data = { ...real, byFactor: null, omitted: { factors: 'Las series de factores cubren 2 de 4 periodos.' } }
    render(<RiskSources portfolioId="p1" />)
    expect(screen.getByRole('button', { name: 'Factor' })).toBeDisabled()
    expect(screen.getByText(/Las series de factores cubren 2 de 4 periodos/)).toBeInTheDocument()
  })

  it('shows the route message instead of an empty chart', () => {
    state.data = { message: 'Se necesitan al menos dos posiciones para comparar asignaciones.' }
    render(<RiskSources portfolioId="p1" />)
    expect(screen.getByText('Se necesitan al menos dos posiciones para comparar asignaciones.')).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Ver el riesgo por' })).toBeNull()
  })
})
