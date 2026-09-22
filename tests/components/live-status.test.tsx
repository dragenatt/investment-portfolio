import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import es from '@/app/dictionaries/es.json'

vi.mock('@/lib/i18n', () => ({ useTranslation: () => ({ t: es, locale: 'es' }) }))

const { LiveStatus } = await import('@/components/dashboard/live-status')

afterEach(() => {
  vi.useRealTimers()
})

function at(iso: string) {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(iso))
}

describe('LiveStatus', () => {
  it('says the market is open and how recently the prices were fetched', () => {
    at('2026-09-21T15:00:00Z') // Monday, 11:00 in New York
    render(<LiveStatus quotes={{ AAA: { fetchedAt: '2026-09-21T14:59:52Z' }, BBB: { fetchedAt: '2026-09-21T14:59:40Z' } }} />)

    const line = screen.getByTestId('live-status')
    expect(line).toHaveTextContent('Mercado de EE.UU. abierto')
    // The newest fetch, eight seconds ago.
    expect(line).toHaveTextContent('precios revisados hace 8 s')
  })

  it('warns when the prices stop updating during the session', () => {
    at('2026-09-21T15:00:00Z')
    render(<LiveStatus quotes={{ AAA: { fetchedAt: '2026-09-21T14:55:00Z' } }} />)

    expect(screen.getByTestId('live-status')).toHaveTextContent('los precios no se actualizan desde hace 5 min')
  })

  it('does not call an old price stale when the market is closed', () => {
    at('2026-09-19T15:00:00Z') // Saturday
    render(<LiveStatus quotes={{ AAA: { fetchedAt: '2026-09-19T14:30:00Z' } }} />)

    const line = screen.getByTestId('live-status')
    expect(line).toHaveTextContent('Mercado de EE.UU. cerrado (fin de semana)')
    expect(line).toHaveTextContent('precios revisados hace 30 min')
  })

  it('says the prices are loading before any have arrived', () => {
    at('2026-09-21T15:00:00Z')
    render(<LiveStatus quotes={undefined} />)

    expect(screen.getByTestId('live-status')).toHaveTextContent('cargando precios')
  })
})
