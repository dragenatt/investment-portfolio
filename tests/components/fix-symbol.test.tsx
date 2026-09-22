import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import es from '@/app/dictionaries/es.json'

vi.mock('@/lib/i18n', () => ({ useTranslation: () => ({ t: es, locale: 'es' }) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/hooks/use-currency', () => ({
  useCurrency: () => ({ currency: 'MXN', convert: (n: number) => n, canConvert: () => true, format: (n: number) => `$${n.toFixed(2)}` }),
}))

const { PositionPnLTable } = await import('@/components/dashboard/position-pnl-table')

function position(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pos1',
    symbol: 'FEMSAUBD',
    asset_type: 'stock',
    quantity: 10,
    avg_cost: 180,
    currency: 'MXN',
    current_price: 180,
    market_value: 1800,
    pnl_absolute: 0,
    pnl_percent: 0,
    daily_change: 0,
    daily_change_pct: 0,
    sparkline_7d: [],
    freshness: { status: 'unavailable' as const, label: 'Sin precio' },
    ...overrides,
  }
}

const fixLabel = `${es.portfolio.no_price} · ${es.portfolio.fix_symbol}`
const priced = position({ id: 'pos0', symbol: 'AAA', freshness: { status: 'live' as const, label: '' } })

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe('correcting a position\'s symbol', () => {
  it('is offered only for a position nothing prices, on the owner\'s screen', () => {
    const { unmount } = render(<PositionPnLTable positions={[priced, position()]} portfolioId="pf1" />)
    expect(screen.getAllByRole('button', { name: fixLabel }).length).toBeGreaterThan(0)
    unmount()

    const allPriced = render(<PositionPnLTable positions={[priced]} portfolioId="pf1" />)
    expect(screen.queryByRole('button', { name: fixLabel })).not.toBeInTheDocument()
    allPriced.unmount()

    const notOwner = render(<PositionPnLTable positions={[priced, position()]} />)
    expect(screen.queryByRole('button', { name: fixLabel })).not.toBeInTheDocument()
    notOwner.unmount()

    // Nothing priced at all: the provider is down, not the symbol wrong.
    render(<PositionPnLTable positions={[position(), position({ id: 'pos2', symbol: 'BBB' })]} portfolioId="pf1" />)
    expect(screen.queryByRole('button', { name: fixLabel })).not.toBeInTheDocument()
  })

  it('suggests the spelling that prices and saves it', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/market/batch')) {
        return { ok: true, json: async () => ({ data: { 'FEMSAUBD.MX': { price: 206.58, currency: 'MXN' } } }) }
      }
      expect(init?.method).toBe('PATCH')
      return { ok: true, json: async () => ({ data: { id: 'pos1', symbol: 'FEMSAUBD.MX', changed: true }, error: null }) }
    })
    vi.stubGlobal('fetch', fetchMock)
    const reload = vi.fn()
    render(<PositionPnLTable positions={[priced, position()]} portfolioId="pf1" onPositionChanged={reload} />)

    fireEvent.click(screen.getAllByRole('button', { name: fixLabel })[0])
    const dialog = await screen.findByRole('dialog')
    await waitFor(() => expect(within(dialog).getByLabelText(es.portfolio.fix_symbol_label)).toHaveValue('FEMSAUBD.MX'))
    expect(within(dialog).getByRole('status')).toHaveTextContent('FEMSAUBD.MX')

    fireEvent.click(within(dialog).getByRole('button', { name: es.portfolio.fix_symbol_save }))

    await waitFor(() => expect(reload).toHaveBeenCalled())
    expect(fetchMock).toHaveBeenCalledWith('/api/portfolio/pf1/positions/pos1', expect.objectContaining({ method: 'PATCH' }))
  })

  it('shows why the server refused the new symbol', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      url.startsWith('/api/market/batch')
        ? { ok: true, json: async () => ({ data: {} }) }
        : { ok: false, status: 422, json: async () => ({ data: null, error: 'Ningún proveedor de precios reconoce OTRO.' }) },
    ))
    render(<PositionPnLTable positions={[priced, position()]} portfolioId="pf1" />)

    fireEvent.click(screen.getAllByRole('button', { name: fixLabel })[0])
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText(es.portfolio.fix_symbol_label), { target: { value: 'otro' } })
    fireEvent.click(within(dialog).getByRole('button', { name: es.portfolio.fix_symbol_save }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Ningún proveedor de precios reconoce OTRO.')
  })
})
