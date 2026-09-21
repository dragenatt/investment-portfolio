import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PriceChart } from '@/components/market/price-chart'

// The asset page shows its price converted into the display currency, and the
// chart under it moved that header when hovered — while printing its own
// figures in the asset's currency with no label: a peso header, a "+5.00"
// range change and a "$230.12" tooltip for the same point. Synthetic prices.

const PESOS_PER_DOLLAR = 17

vi.mock('@/lib/hooks/use-currency', () => ({
  useCurrency: () => ({
    currency: 'MXN',
    setCurrency: vi.fn(),
    rates: { USD: 1, MXN: PESOS_PER_DOLLAR },
    convert: (amount: number, from: string) => (from === 'USD' ? amount * PESOS_PER_DOLLAR : amount),
    canConvert: () => true,
    format: (amount: number) => `$${amount.toFixed(2)} MXN`,
  }),
}))

vi.mock('@/lib/hooks/use-market', () => ({
  usePriceHistory: () => ({
    data: [
      { date: '2026-08-21', close: 100 },
      { date: '2026-09-21', close: 105 },
    ],
    isLoading: false,
    error: null,
    mutate: vi.fn(),
  }),
}))

describe('PriceChart', () => {
  it('states the range change in the display currency, like the header above it', () => {
    render(<PriceChart symbol="SYN" currency="USD" />)

    // 5 dollars at 17 pesos each.
    expect(screen.getByText('+$85.00 MXN')).toBeInTheDocument()
    expect(screen.queryByText(/^\+5\.00/)).not.toBeInTheDocument()
  })

  it('labels the text alternative with the currency its figures are in', () => {
    const { container } = render(<PriceChart symbol="SYN" currency="USD" />)

    const caption = container.querySelector('figcaption')?.textContent ?? ''
    expect(caption).toContain('$1,700.00 MXN')
    expect(caption).toContain('$1,785.00 MXN')
  })

  it('leaves the figures unlabelled while the quote, and so the currency, is unknown', () => {
    render(<PriceChart symbol="SYN" currency={null} />)

    expect(screen.getByText(/^\+5\.00/)).toBeInTheDocument()
    expect(screen.queryByText(/MXN/)).not.toBeInTheDocument()
  })
})
