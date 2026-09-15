import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { RiskSourcesData } from '@/lib/hooks/use-analytics'

const state: { data?: RiskSourcesData; error?: Error; isLoading: boolean } = { isLoading: false }
vi.mock('@/lib/hooks/use-analytics', () => ({
  useRiskSources: () => ({ ...state, mutate: vi.fn() }),
}))

import { RiskSources } from '@/components/analytics/risk-sources'

// The shape the route returned for the owner's portfolio on 2026-09-15, trimmed.
const real: RiskSourcesData = {
  observations: 124,
  portfolioVolatilityPct: 18.25,
  byAsset: [
    { symbol: '^IXIC', sector: 'Índices', weightPct: 51.7, volatilityPct: 21.3, correlationWithPortfolio: 0.98, betaToBenchmark: 1.3, percentOfRisk: 53.6 },
    { symbol: 'MSFT', sector: 'Acciones (sin sector)', weightPct: 18.5, volatilityPct: 25.1, correlationWithPortfolio: 0.77, betaToBenchmark: 1.1, percentOfRisk: 26.6 },
    { symbol: 'VOO', sector: 'ETF', weightPct: 25.7, volatilityPct: 14.2, correlationWithPortfolio: 0.91, betaToBenchmark: 1, percentOfRisk: 17.7 },
  ],
  bySector: [
    { sector: 'Índices', weightPct: 55.5, percentOfRisk: 55.6, symbols: ['^IXIC', '^DJI'] },
    { sector: 'Acciones (sin sector)', weightPct: 18.7, percentOfRisk: 26.7, symbols: ['MSFT', 'AAPL'] },
    { sector: 'ETF', weightPct: 25.7, percentOfRisk: 17.7, symbols: ['VOO'] },
  ],
  byComponent: {
    effectiveBets: 2.94,
    components: [
      { index: 1, percentOfRisk: 80.1, varianceExplainedPct: 54.7, nearlyTied: false, loadings: [{ symbol: 'MSFT', loading: 0.6 }, { symbol: '^IXIC', loading: 0.5 }] },
      { index: 2, percentOfRisk: 2.4, varianceExplainedPct: 25.4, nearlyTied: false, loadings: [{ symbol: 'AAPL', loading: -0.7 }] },
    ],
  },
  byFactor: {
    explainedPct: 88.79,
    specificPct: 11.21,
    factors: [
      { id: 'market', name: 'Mercado', exposure: 1.19, significant: true, percentOfRisk: 73.8 },
      { id: 'value', name: 'Valor (baratas menos caras)', exposure: -0.4, significant: true, percentOfRisk: 17.8 },
      { id: 'momentum', name: 'Momentum', exposure: 0.2, significant: true, percentOfRisk: -4.8 },
    ],
  },
  market: { symbol: 'SPY', name: 'S&P 500', beta: 1.2031, correlation: 0.9099, systematicPct: 82.79, specificPct: 17.21 },
  correlation: { averagePairwise: 0.7, highestPair: { a: '^GSPC', b: 'VOO', correlation: 0.99 } },
  findings: [
    '^IXIC genera el 54% del riesgo con el 52% del dinero.',
    'El S&P 500 explica el 83% de las variaciones del portafolio (beta 1.20); el 17% restante no lo explica el mercado.',
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
    expect(screen.getByText('^IXIC genera el 54% del riesgo con el 52% del dinero.')).toBeInTheDocument()
    expect(screen.getByText(/no predice el futuro ni es una recomendación/)).toBeInTheDocument()
  })

  it('switches the same risk between lenses, each with its text alternative', () => {
    state.data = real
    const { container } = render(<RiskSources portfolioId="p1" />)
    const caption = () => container.querySelector('figcaption')!.textContent ?? ''

    expect(caption()).toContain('Riesgo por activo: ^IXIC 53.6%')

    fireEvent.click(screen.getByRole('button', { name: 'Factor' }))
    expect(caption()).toContain('Riesgo por factor: Mercado 73.8%')
    expect(screen.getByRole('button', { name: 'Factor' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'Componente' }))
    expect(caption()).toContain('Componente 1 80.1%')
    expect(screen.getByText(/apuestas independientes/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Mercado' }))
    expect(caption()).toContain('Explicado por S&P 500 82.8%')
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
