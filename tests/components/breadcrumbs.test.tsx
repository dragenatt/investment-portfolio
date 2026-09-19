import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Breadcrumbs } from '@/components/shared/breadcrumbs'

// The trail printed the raw id of whatever record the page was showing —
// "Portafolios › ae9f2d48-… › Análisis" — the one thing on the page a reader
// cannot recognise. Synthetic ids and names.

const path = vi.hoisted(() => ({ value: '/dashboard' }))
const responses = vi.hoisted(() => ({ byKey: new Map<string, unknown>() }))

vi.mock('next/navigation', () => ({ usePathname: () => path.value }))

vi.mock('swr', () => ({
  default: (key: string | null) => ({ data: key === null ? undefined : responses.byKey.get(key) }),
}))

const PID = 'ae9f2d48-bdc4-4f02-9f33-889574496612'
const GID = 'b1c2d3e4-0000-4000-8000-000000000001'

beforeEach(() => {
  responses.byKey.clear()
  responses.byKey.set('/api/portfolio', [{ id: PID, name: 'Cartera larga' }])
  responses.byKey.set(`/api/goals/${GID}`, { name: 'Enganche' })
})

describe('Breadcrumbs', () => {
  it("names a portfolio instead of printing its id", () => {
    path.value = `/portfolio/${PID}/analytics`
    render(<Breadcrumbs />)
    expect(screen.getByText('Cartera larga')).toBeInTheDocument()
    expect(screen.queryByText(PID)).not.toBeInTheDocument()
    expect(screen.getByText('Análisis')).toBeInTheDocument()
  })

  it('says what kind of record it is while the name loads, never the id', () => {
    responses.byKey.delete('/api/portfolio')
    path.value = `/portfolio/${PID}`
    render(<Breadcrumbs />)
    expect(screen.getByText('Portafolio')).toBeInTheDocument()
    expect(screen.queryByText(PID)).not.toBeInTheDocument()
  })

  it('names a goal too', () => {
    path.value = `/goals/${GID}`
    render(<Breadcrumbs />)
    expect(screen.getByText('Enganche')).toBeInTheDocument()
  })

  it('leaves the labelled sections and symbols alone', () => {
    path.value = '/market/%5EGSPC'
    render(<Breadcrumbs />)
    expect(screen.getByText('Mercados')).toBeInTheDocument()
    expect(screen.getByText('S&P 500')).toBeInTheDocument()
  })

  it('shows nothing at the top level', () => {
    path.value = '/dashboard'
    const { container } = render(<Breadcrumbs />)
    expect(container.firstChild).toBeNull()
  })
})
