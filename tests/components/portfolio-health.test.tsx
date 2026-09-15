import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import type { HealthData } from '@/lib/hooks/use-analytics'
import { computePortfolioHealth } from '@/lib/services/portfolio-health'
import { analyseRiskSources } from '@/lib/services/risk-sources'
import { mulberry32, standardNormal } from '@/lib/utils/random'

const state: { data?: HealthData; error?: Error; isLoading: boolean } = { isLoading: false }
vi.mock('@/lib/hooks/use-analytics', () => ({ useHealth: () => ({ ...state, mutate: vi.fn() }) }))

import { PortfolioHealth } from '@/components/analytics/portfolio-health'

// Seeded synthetic holdings — this repository is public.
function sample(): HealthData {
  const noise = (seed: number, sd: number) => {
    const random = mulberry32(seed)
    return Array.from({ length: 200 }, () => standardNormal(random) * sd)
  }
  const market = noise(1, 0.01)
  const returnsMatrix = [2, 3, 4].map((seed, i) => noise(seed, 0.006).map((r, t) => r + market[t] * (0.6 + 0.3 * i)))
  const holdings = ['AAA', 'BBB', 'CCC'].map((symbol, i) => ({
    symbol,
    weight: [0.5, 0.3, 0.2][i],
    quantity: 10,
    assetType: 'stock',
    companySector: ['Technology', 'Energy', null][i],
    currency: 'USD',
    country: null,
    averageDailyVolume: 1_000_000,
  }))
  const riskSources = analyseRiskSources({
    symbols: holdings.map((h) => h.symbol),
    weights: holdings.map((h) => h.weight),
    returnsMatrix,
    periodsPerYear: 252,
    benchmark: { symbol: 'SPY', name: 'S&P 500', returns: market },
  })!
  const health = computePortfolioHealth({ holdings, returnsMatrix, benchmarkReturns: market, benchmarkName: 'S&P 500', periodsPerYear: 252, riskSources })!
  return { ...health, window: { from: '2026-01-02', to: '2026-09-14', intervals_used: 199, cadence: '1 dia' }, benchmark: { symbol: 'SPY', name: 'S&P 500' } }
}

describe('PortfolioHealth', () => {
  it('shows the score, its band, and every component with what was measured', () => {
    const data = sample()
    state.data = data
    render(<PortfolioHealth portfolioId="p1" />)
    expect(screen.getByText('Portfolio Health')).toBeInTheDocument()
    expect(screen.getByText(data.bandLabel!)).toBeInTheDocument()
    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(9)
    for (const component of data.components!) {
      const item = items.find((li) => within(li).queryByText(component.name))!
      expect(item).toBeTruthy()
      expect(within(item).getByText(component.score === null ? component.unavailableReason! : component.measured)).toBeInTheDocument()
      if (component.score !== null) expect(within(item).getByRole('meter')).toHaveAttribute('aria-valuenow', String(component.score))
      else expect(within(item).getByText('Sin datos')).toBeInTheDocument()
    }
  })

  it('keeps the grading visible behind each component and says it is not advice', () => {
    state.data = sample()
    render(<PortfolioHealth portfolioId="p1" />)
    expect(screen.getAllByText('Cómo se califica')).toHaveLength(9)
    expect(screen.getByText(/Directiva UCITS 2009\/65\/CE/)).toBeInTheDocument()
    expect(screen.getAllByText(/no es una recomendación de compra o venta/).length).toBeGreaterThan(0)
  })

  it('shows the route message when there is nothing to grade', () => {
    state.data = { message: 'No hay posiciones.' }
    render(<PortfolioHealth portfolioId="p1" />)
    expect(screen.getByText('No hay posiciones.')).toBeInTheDocument()
    expect(screen.queryByRole('meter')).toBeNull()
  })
})
