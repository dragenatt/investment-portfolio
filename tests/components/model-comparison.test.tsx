import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { ModelComparison } from '@/components/analytics/model-comparison'
import { compareModels } from '@/lib/services/model-comparison'
import { calculateCovarianceMatrix } from '@/lib/services/covariance'
import { historicalExpectedReturns } from '@/lib/services/optimizer'
import { mulberry32, standardNormal } from '@/lib/utils/random'

// Synthetic, seeded holdings — this repository is public, so no real portfolio goes in a fixture.
function comparison() {
  const noise = (seed: number, sd: number, drift: number) => {
    const random = mulberry32(seed)
    return Array.from({ length: 250 }, () => drift + standardNormal(random) * sd)
  }
  const market = noise(1, 0.009, 0.0003)
  const returnsMatrix = [0.012, 0.006, 0.004].map((sd, i) => noise(i + 2, sd, 0.0002 * (i + 1)).map((r, t) => r + market[t]))
  const symbols = ['AAA', 'BBB', 'CCC']
  const cov = calculateCovarianceMatrix(returnsMatrix).map((row) => row.map((v) => v * 252))
  const estimatedReturns = historicalExpectedReturns(returnsMatrix)!
  const ranges = symbols.map((symbol, i) => {
    const se = Math.sqrt(cov[i][i]) / Math.sqrt(250 / 252)
    return { symbol, low: estimatedReturns[i] - se, high: estimatedReturns[i] + se }
  })
  return compareModels({ symbols, returnsMatrix, cov, estimatedReturns, riskFreeRate: 0.05, currentWeights: [0.5, 0.3, 0.2], ranges })!
}

const data = comparison()

describe('ModelComparison', () => {
  it('puts the five models and the current book side by side, every metric the task lists', () => {
    render(<ModelComparison data={data} />)
    const table = screen.getByRole('table', { name: /Métricas de cada modelo/ })
    const headers = within(table).getAllByRole('columnheader').map((h) => h.textContent)
    expect(headers).toEqual([
      'Métrica',
      'Markowitz (máximo Sharpe)',
      'Mínimo CVaR',
      'Paridad de riesgo',
      'Black-Litterman (sin opiniones)',
      'Optimización robusta',
      'Tu cartera actual',
    ])
    const rows = within(table).getAllByRole('rowheader').map((h) => h.firstChild?.textContent)
    expect(rows).toEqual(['Rendimiento estimado', 'Volatilidad', 'Sharpe', 'VaR 95%', 'CVaR 95%', 'Concentración', 'Drawdown estimado'])
  })

  it('shows the figures as computed, and marks no model as the best', () => {
    const { container } = render(<ModelComparison data={data} />)
    const markowitz = data.models.find((m) => m.id === 'markowitz')!
    expect(screen.getAllByText(markowitz.sharpe!.toFixed(2)).length).toBeGreaterThan(0)
    const table = screen.getByRole('table', { name: /Métricas de cada modelo/ })
    expect(within(table).getAllByRole('cell')).toHaveLength(7 * 6)
    expect(container.textContent).not.toMatch(/mejor modelo|recomendado|ganador/i)
    expect(screen.getByText(/Ningún modelo es superior/)).toBeInTheDocument()
    expect(screen.getByText(data.summary)).toBeInTheDocument()
  })

  it('explains what each model optimises and says when one could not run', () => {
    render(<ModelComparison data={{ ...data, unavailable: [{ id: 'robust', name: 'Optimización robusta', reason: 'No hay rangos de rendimiento con los que optimizar el peor caso.' }] }} />)
    expect(screen.getByText('Qué optimiza cada modelo y en qué se apoya')).toBeInTheDocument()
    expect(screen.getByText(/no disponible\. No hay rangos/)).toBeInTheDocument()
  })

  it('shows an empty state rather than an empty table', () => {
    render(<ModelComparison data={null} />)
    expect(screen.getByText(/Se necesitan al menos dos posiciones/)).toBeInTheDocument()
    expect(screen.queryByRole('table')).toBeNull()
  })
})
