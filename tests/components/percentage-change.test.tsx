import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PercentageChange } from '@/components/shared/percentage-change'

describe('PercentageChange', () => {
  it('renders -- when value is null', () => {
    render(<PercentageChange value={null} />)
    expect(screen.getByText('--')).toBeInTheDocument()
  })

  it('renders -- when value is undefined', () => {
    render(<PercentageChange value={undefined} />)
    expect(screen.getByText('--')).toBeInTheDocument()
  })

  it('renders positive value with plus sign and up arrow', () => {
    render(<PercentageChange value={5.25} />)
    const span = screen.getByText(/\+5.25%/)
    expect(span).toBeInTheDocument()
    expect(span.textContent).toMatch(/↑/)
  })

  it('renders negative value with minus sign and down arrow', () => {
    render(<PercentageChange value={-3.75} />)
    const span = screen.getByText(/-3.75%/)
    expect(span).toBeInTheDocument()
    expect(span.textContent).toMatch(/↓/)
  })

  it('renders zero with plus sign and up arrow', () => {
    render(<PercentageChange value={0} />)
    const span = screen.getByText(/\+0.00%/)
    expect(span).toBeInTheDocument()
    expect(span.textContent).toMatch(/↑/)
  })

  it('applies green color class for positive values', () => {
    render(<PercentageChange value={10} />)
    const span = screen.getByText(/\+10.00%/)
    expect(span).toHaveClass('text-emerald-500')
  })

  it('applies green color class for zero', () => {
    render(<PercentageChange value={0} />)
    const span = screen.getByText(/\+0.00%/)
    expect(span).toHaveClass('text-emerald-500')
  })

  it('applies red color class for negative values', () => {
    render(<PercentageChange value={-5} />)
    const span = screen.getByText(/-5.00%/)
    expect(span).toHaveClass('text-red-500')
  })

  it('formats decimal places to exactly 2', () => {
    render(<PercentageChange value={5.123456} />)
    expect(screen.getByText(/\+5.12%/)).toBeInTheDocument()
  })

  it('formats negative decimals to exactly 2 places', () => {
    render(<PercentageChange value={-2.987654} />)
    expect(screen.getByText(/-2.99%/)).toBeInTheDocument()
  })

  it('applies custom className', () => {
    render(<PercentageChange value={5} className="custom-class" />)
    const span = screen.getByText(/\+5.00%/)
    expect(span).toHaveClass('custom-class')
  })

  it('always has font-mono class', () => {
    render(<PercentageChange value={5} />)
    const span = screen.getByText(/\+5.00%/)
    expect(span).toHaveClass('font-mono')
  })

  it('handles very small positive values', () => {
    render(<PercentageChange value={0.01} />)
    expect(screen.getByText(/\+0.01%/)).toBeInTheDocument()
  })

  it('handles very small negative values', () => {
    render(<PercentageChange value={-0.01} />)
    expect(screen.getByText(/-0.01%/)).toBeInTheDocument()
  })

  it('handles large percentage changes', () => {
    render(<PercentageChange value={150.99} />)
    const span = screen.getByText(/\+150.99%/)
    expect(span).toHaveClass('text-emerald-500')
  })

  it('handles large negative percentage changes', () => {
    render(<PercentageChange value={-99.99} />)
    const span = screen.getByText(/-99.99%/)
    expect(span).toHaveClass('text-red-500')
  })
})
