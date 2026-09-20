import { describe, it, expect, vi } from 'vitest'
import { render, screen, renderHook } from '@testing-library/react'

// convertCurrency returned the amount unchanged when it did not know a
// currency, and the dashboard total added it as if it were already in the
// right one: a position quoted in yen counted as pesos, and the header — the
// number people actually read — said nothing. Synthetic positions.

const RATES: Record<string, number> = { USD: 1, MXN: 17.5, EUR: 0.92 }

vi.mock('@/lib/hooks/use-currency', () => ({
  useCurrency: () => ({
    currency: 'MXN',
    setCurrency: vi.fn(),
    rates: RATES,
    convert: (amount: number, from: string) =>
      RATES[from] && RATES.MXN ? (amount / RATES[from]) * RATES.MXN : amount,
    canConvert: (from: string) => from === 'MXN' || Boolean(RATES[from]),
    format: (amount: number) => `$${amount.toFixed(2)} MXN`,
  }),
}))

vi.mock('@/lib/i18n', () => ({
  useTranslation: () => ({
    t: { dashboard: { portfolio_value: 'Valor del portafolio', hide_balance: 'Ocultar', show_balance: 'Mostrar' } },
  }),
}))

const { usePortfolioStats } = await import('@/lib/hooks/use-portfolio-stats')
const { KpiCards } = await import('@/components/dashboard/kpi-cards')

const position = (symbol: string, currency: string) => ({
  symbol,
  quantity: 10,
  avg_cost: 100,
  currency,
  asset_type: 'stock',
})

describe('usePortfolioStats', () => {
  it('reports the currencies the total could not be put into', () => {
    const { result } = renderHook(() =>
      usePortfolioStats(
        [{ positions: [position('AAA', 'USD'), position('BBB', 'JPY')] }],
        { AAA: { price: 120, currency: 'USD' }, BBB: { price: 1200, currency: 'JPY' } },
      ),
    )

    expect(result.current.unconverted).toEqual(['JPY'])
  })

  it('says nothing when every position could be converted', () => {
    const { result } = renderHook(() =>
      usePortfolioStats(
        [{ positions: [position('AAA', 'USD'), position('CCC', 'MXN')] }],
        { AAA: { price: 120, currency: 'USD' } },
      ),
    )

    expect(result.current.unconverted).toEqual([])
  })

  it('notices a cost currency it cannot convert even when the price is fine', () => {
    // The position was bought in reais and now quotes in dollars: the value
    // converts, the cost does not, and the return is the difference of two
    // different units.
    const { result } = renderHook(() =>
      usePortfolioStats(
        [{ positions: [position('DDD', 'BRL')] }],
        { DDD: { price: 30, currency: 'USD' } },
      ),
    )

    expect(result.current.unconverted).toEqual(['BRL'])
  })
})

describe('KpiCards', () => {
  it('warns when the total mixes a currency it could not convert', () => {
    render(<KpiCards totalValue={1000} totalReturn={50} totalReturnPct={5} positionCount={2} unconverted={['JPY']} />)

    expect(screen.getByRole('status')).toHaveTextContent(/no hay tipo de cambio para jpy/i)
  })

  it('stays quiet when there is nothing to warn about', () => {
    render(<KpiCards totalValue={1000} totalReturn={50} totalReturnPct={5} positionCount={2} unconverted={[]} />)

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
