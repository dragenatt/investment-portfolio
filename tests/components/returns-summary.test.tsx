import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ReturnsSummary } from '@/components/analytics/returns-summary'
import { mwrForDisplay, snapshotsCoverWindow, measuredSpanDays } from '@/lib/services/returns'

// Production, 2026-09-21: a book three days old and up 0.63% showed
// "MWR +115.67% — Tu rendimiento real" next to "Retorno Simple +0.63%", both
// labelled 1Y. XIRR is an annual rate; three days of it raised to a year is
// not anybody's real return. And a TWR the route could not compute (null) was
// turned into 0 on the way in and shown as a measured 0.00%. Synthetic figures.

describe('mwrForDisplay', () => {
  it('takes an annual rate on young capital back to the span actually invested', () => {
    // +115.67% a year, held for 3.1 days, is about +0.65% — which is what the
    // simple return next to it said all along.
    const shown = mwrForDisplay(115.67, 3.1)!

    expect(shown.annualised).toBe(false)
    expect(shown.days).toBeCloseTo(3.1)
    expect(shown.value).toBeCloseTo(0.655, 2)
  })

  it('leaves a rate on capital a year old or more annual', () => {
    expect(mwrForDisplay(8.2, 400)).toEqual({ value: 8.2, annualised: true, days: null })
    expect(mwrForDisplay(8.2, 365)).toEqual({ value: 8.2, annualised: true, days: null })
  })

  it('keeps a loss a loss when shortening it', () => {
    const shown = mwrForDisplay(-50, 30)!
    expect(shown.value).toBeLessThan(0)
    expect(shown.value).toBeGreaterThan(-50)
  })

  it('says nothing when there is nothing to say', () => {
    expect(mwrForDisplay(null, 10)).toBeNull()
    expect(mwrForDisplay(undefined, 10)).toBeNull()
    expect(mwrForDisplay(Number.NaN, 10)).toBeNull()
  })

  it('does not invent a span it was not given', () => {
    expect(mwrForDisplay(12, null)).toEqual({ value: 12, annualised: true, days: null })
  })
})

describe('ReturnsSummary', () => {
  it('shows a young book\'s money-weighted return for its real span, labelled', () => {
    render(<ReturnsSummary simple={0.63} twr={-0.003} mwr={115.67} capitalAgeDays={3.1} period="1Y" />)

    expect(screen.queryByText('+115.67%')).not.toBeInTheDocument()
    expect(screen.getAllByText('+0.65%').length).toBeGreaterThan(0)
    expect(screen.getByText('en 3 días · sin anualizar')).toBeInTheDocument()
  })

  it('shows a figure the route could not compute as missing, not as 0.00%', () => {
    render(<ReturnsSummary simple={1.2} twr={null} mwr={null} capitalAgeDays={null} period="1Y" />)

    expect(screen.getAllByText('--').length).toBeGreaterThanOrEqual(2)
    expect(screen.queryByText('0.00%')).not.toBeInTheDocument()
    expect(screen.getAllByText('Aún no hay historia suficiente para medirlo')).toHaveLength(2)
  })

  it('shows an annual rate as annual once the capital is a year old', () => {
    render(<ReturnsSummary simple={9.1} twr={7.4} mwr={8.2} capitalAgeDays={500} period="1Y" />)

    expect(screen.getAllByText('+8.20%').length).toBeGreaterThan(0)
    expect(screen.queryByText(/sin anualizar/)).not.toBeInTheDocument()
  })
})

// The TWR on the same card came from nightly snapshots, which exist from the
// night migration 024 shipped. For every older book they began mid-window, so
// the TWR measured the last day or two and was labelled "1Y" — next to a
// simple return covering every day since the first purchase.

describe('snapshotsCoverWindow', () => {
  const nightly = (from: string, days: number) =>
    Array.from({ length: days }, (_, i) => ({ date: new Date(Date.parse(from) + i * 86_400_000).toISOString().slice(0, 10) }))

  it('accepts a nightly series that starts with the window', () => {
    expect(snapshotsCoverWindow(nightly('2026-01-02', 10), '2026-01-01')).toBe(true)
  })

  it('rejects a series that begins well after the window does', () => {
    // A year's window, snapshots from the last three nights only.
    expect(snapshotsCoverWindow(nightly('2026-09-19', 3), '2025-09-21')).toBe(false)
  })

  it('rejects a series too short to measure anything', () => {
    expect(snapshotsCoverWindow(nightly('2026-01-01', 1), '2026-01-01')).toBe(false)
  })
})

describe('measuredSpanDays', () => {
  it('is null when the series covers the period, allowing for a long weekend', () => {
    // Cutoff on a Friday holiday; the first trading day is the Tuesday after.
    expect(measuredSpanDays([{ date: '2026-04-07' }, { date: '2026-09-21' }], '2026-04-03')).toBeNull()
  })

  it('is the span of a series younger than the period', () => {
    expect(measuredSpanDays([{ date: '2026-09-18' }, { date: '2026-09-21' }], '2025-09-21')).toBe(3)
  })
})

describe('ReturnsSummary labels each figure with what it covers', () => {
  it('says how many days a short TWR measured instead of naming the period', () => {
    render(<ReturnsSummary simple={0.63} twr={0.6} mwr={null} twrDays={3} period="1Y" />)

    expect(screen.getByText('en 3 días')).toBeInTheDocument()
  })

  it('does not label the simple return with a period it does not cover', () => {
    render(<ReturnsSummary simple={0.63} twr={7.4} mwr={null} period="1Y" />)

    expect(screen.getByText('desde la compra')).toBeInTheDocument()
    // The TWR covers the period, so it keeps the period's name; so does the
    // MWR, which has no figure here. The simple return no longer does.
    expect(screen.getAllByText('1Y')).toHaveLength(2)
  })
})
