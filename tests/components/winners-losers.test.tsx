import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { WinnersLosers } from '@/components/discover/winners-losers'

// The widget was written for assets (symbol, price, daily change) while its
// route returned portfolios, so every row showed "--", React warned about a
// missing key (key={undefined}), and a click went to /market/undefined.
// Synthetic portfolios.

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))

const winner = { portfolio_id: 'p-up', name: 'Alfa', change: 120, change_pct: 1.2 }
const loser = { portfolio_id: 'p-down', name: 'Beta', change: -80, change_pct: -0.8 }

afterEach(() => {
  push.mockReset()
  vi.restoreAllMocks()
})

describe('WinnersLosers', () => {
  it('shows each portfolio with its change, not "--"', () => {
    render(<WinnersLosers winners={[winner]} losers={[loser]} />)

    expect(screen.getByText('Alfa')).toBeInTheDocument()
    expect(screen.getByText('+1.20%')).toBeInTheDocument()
    expect(screen.getByText('Beta')).toBeInTheDocument()
    expect(screen.getByText('-0.80%')).toBeInTheDocument()
  })

  it('gives every row a key', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(<WinnersLosers winners={[winner, { ...winner, portfolio_id: 'p-up-2', name: 'Gamma' }]} losers={[loser]} />)

    const keyWarnings = errors.mock.calls.filter((call) => String(call[0]).includes('unique "key"'))
    expect(keyWarnings).toEqual([])
  })

  it('opens the public portfolio, not /market/undefined', () => {
    render(<WinnersLosers winners={[winner]} losers={[]} />)

    fireEvent.click(screen.getByRole('button', { name: /Alfa/ }))

    expect(push).toHaveBeenCalledWith('/portfolio/p-up/public')
  })
})
