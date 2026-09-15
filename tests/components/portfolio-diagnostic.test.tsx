import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import type { DiagnosticData } from '@/lib/hooks/use-analytics'
import { diagnosePortfolio } from '@/lib/services/portfolio-diagnostic'

const state: { data?: DiagnosticData; error?: Error; isLoading: boolean } = { isLoading: false }
vi.mock('@/lib/hooks/use-analytics', () => ({ useDiagnostic: () => ({ ...state, mutate: vi.fn() }) }))

import { PortfolioDiagnostic } from '@/components/analytics/portfolio-diagnostic'

describe('PortfolioDiagnostic', () => {
  it('lists every question with its answer and figures, or why it has none', () => {
    const answered = {
      id: 'vs_benchmark' as const,
      question: '¿Cómo me fue contra el benchmark?',
      answer: 'Entre 2026-01-01 y 2026-06-30 tu portafolio rindió +8.00% (ponderado por tiempo) y S&P 500 +5.00%: 3.00 puntos por encima.',
      figures: [{ label: 'Diferencia', value: '+3.00 pp' }],
    }
    const empty = diagnosePortfolio({ riskSources: null, holdings: null, cov: null, growth: null, windowStart: null, attribution: null, benchmark: null })
    state.data = { ...empty, answers: [answered, ...empty.answers.filter((a) => a.id !== 'vs_benchmark')], answered: 1 }

    render(<PortfolioDiagnostic portfolioId="p1" />)
    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(9)
    const first = items[0]
    expect(within(first).getByRole('heading', { name: '¿Cómo me fue contra el benchmark?' })).toBeInTheDocument()
    expect(within(first).getByText('+3.00 pp')).toBeInTheDocument()
    expect(within(items[1]).getByText(/^Sin respuesta:/)).toBeInTheDocument()
    expect(screen.getByText(/no ejecuta cambios ni recomienda comprar o vender/)).toBeInTheDocument()
  })

  it('shows a loading state before the first answer', () => {
    state.data = undefined
    state.isLoading = true
    render(<PortfolioDiagnostic portfolioId="p1" />)
    expect(screen.getByText('Preparando el diagnóstico…')).toBeInTheDocument()
    state.isLoading = false
  })
})
