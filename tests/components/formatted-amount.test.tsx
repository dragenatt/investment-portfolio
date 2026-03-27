import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FormattedAmount } from '@/components/shared/formatted-amount'

// Mock the useCurrency hook
vi.mock('@/lib/hooks/use-currency', () => ({
  useCurrency: vi.fn(() => ({
    format: (amount: number) => `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`,
    convert: (amount: number, from: string) => {
      const rates: Record<string, number> = { USD: 1, MXN: 17.5, EUR: 0.92 }
      return (amount / (rates[from] || 1)) * 1 // convert to USD
    },
    currency: 'USD',
    setCurrency: vi.fn(),
    rates: { USD: 1, MXN: 17.5, EUR: 0.92 },
  })),
}))

describe('FormattedAmount', () => {
  it('renders -- when value is null', () => {
    render(<FormattedAmount value={null} />)
    expect(screen.getByText('--')).toBeInTheDocument()
  })

  it('renders -- when value is undefined', () => {
    render(<FormattedAmount value={undefined} />)
    expect(screen.getByText('--')).toBeInTheDocument()
  })

  it('formats positive amounts correctly', () => {
    render(<FormattedAmount value={1234.56} />)
    expect(screen.getByText('$1,234.56 USD')).toBeInTheDocument()
  })

  it('formats negative amounts correctly', () => {
    render(<FormattedAmount value={-1234.56} />)
    expect(screen.getByText('-$1,234.56 USD')).toBeInTheDocument()
  })

  it('formats zero correctly', () => {
    render(<FormattedAmount value={0} />)
    expect(screen.getByText('$0.00 USD')).toBeInTheDocument()
  })

  it('adds plus sign when showSign is true for positive values', () => {
    render(<FormattedAmount value={100} showSign={true} />)
    expect(screen.getByText('+$100.00 USD')).toBeInTheDocument()
  })

  it('does not add plus sign for zero when showSign is true', () => {
    render(<FormattedAmount value={0} showSign={true} />)
    expect(screen.getByText('$0.00 USD')).toBeInTheDocument()
  })

  it('adds green color class for positive values when colorize is true', () => {
    render(<FormattedAmount value={100} colorize={true} />)
    const span = screen.getByText('$100.00 USD')
    expect(span).toHaveClass('text-emerald-500')
  })

  it('adds red color class for negative values when colorize is true', () => {
    render(<FormattedAmount value={-100} colorize={true} />)
    const span = screen.getByText('-$100.00 USD')
    expect(span).toHaveClass('text-red-500')
  })

  it('adds green color class for zero when colorize is true', () => {
    render(<FormattedAmount value={0} colorize={true} />)
    const span = screen.getByText('$0.00 USD')
    expect(span).toHaveClass('text-emerald-500')
  })

  it('does not add color class when colorize is false', () => {
    render(<FormattedAmount value={100} colorize={false} />)
    const span = screen.getByText('$100.00 USD')
    expect(span).not.toHaveClass('text-red-500')
    expect(span).not.toHaveClass('text-emerald-500')
  })

  it('formats with compact notation for large numbers', () => {
    render(<FormattedAmount value={1200000} compact={true} />)
    const text = screen.getByText(/\$1.2M USD/)
    expect(text).toBeInTheDocument()
  })

  it('handles compact notation for negative values correctly', () => {
    render(<FormattedAmount value={-1200000} compact={true} />)
    const text = screen.getByText(/-\$1.2M USD/)
    expect(text).toBeInTheDocument()
  })

  it('applies custom className', () => {
    render(<FormattedAmount value={100} className="custom-class" />)
    const span = screen.getByText('$100.00 USD')
    expect(span).toHaveClass('custom-class')
  })

  it('combines colorize and showSign correctly', () => {
    render(<FormattedAmount value={100} colorize={true} showSign={true} />)
    const span = screen.getByText('+$100.00 USD')
    expect(span).toHaveClass('text-emerald-500')
  })

  it('always has font-mono class', () => {
    render(<FormattedAmount value={100} />)
    const span = screen.getByText('$100.00 USD')
    expect(span).toHaveClass('font-mono')
  })
})
