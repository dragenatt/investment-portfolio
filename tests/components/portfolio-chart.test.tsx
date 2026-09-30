import { describe, it, expect, vi } from 'vitest'
import { cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { render } from '@testing-library/react'

// The dashboard chart drew its fill and no line whenever the series was flat.
// The line carries a glow filter, and an SVG filter region defaults to a
// percentage of the element's bounding box: a horizontal line's box is zero
// high, so the region was empty and the browser painted nothing. Measured on
// the dashboard: curve bbox 849×0, `filter: url(#chartLineGlow)`.

// jsdom has no layout, so ResponsiveContainer would measure 0×0 and draw
// nothing; give the chart a size.
vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>()
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactNode }) =>
      isValidElement(children) ? cloneElement(children as ReactElement<{ width: number; height: number }>, { width: 800, height: 250 }) : null,
  }
})

const { PortfolioChart } = await import('@/components/dashboard/portfolio-chart')

describe('PortfolioChart', () => {
  it('sizes the line glow in the chart space, so a flat line is still drawn', () => {
    const flat = [
      { date: '2026-09-18', value: 1000 },
      { date: '2026-09-21', value: 1000 },
    ]
    const { container } = render(<PortfolioChart data={flat} currency="MXN" />)

    const glow = container.querySelector('filter#chartLineGlow')
    expect(glow).not.toBeNull()
    // objectBoundingBox (the default) collapses to nothing on a horizontal line.
    expect(glow!.getAttribute('filterUnits')).toBe('userSpaceOnUse')
    expect(Number.parseFloat(glow!.getAttribute('height') ?? '0')).toBeGreaterThan(0)
  })

  // The axis was `hide`, so a week of trading was a shape with no time under
  // it: a reader could see a vertical step and had no way to tell whether it
  // happened across a weekend or inside a morning.
  // Not scoped under .recharts-xAxis: recharts draws the ticks in their own
  // layer rather than inside the axis group, so that descendant selector
  // matches nothing. This chart's Y axis is hidden, so the tick values on the
  // page are the X axis's and no scoping is needed.
  const tickTexts = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('.recharts-cartesian-axis-tick-value'))
      .map((node) => node.textContent?.trim() ?? '')
      .filter(Boolean)

  it('draws the time axis for a series of closes', () => {
    const closes = [
      { date: '2026-09-01', value: 1000 },
      { date: '2026-09-02', value: 1100 },
      { date: '2026-09-03', value: 1050 },
    ]
    const { container } = render(<PortfolioChart data={closes} currency="MXN" />)
    expect(tickTexts(container).length).toBeGreaterThan(0)
  })

  it('marks each session once on a multi-day intraday window, at the point that opens it', () => {
    const week = [
      { date: '2026-09-25T13:30:00Z', value: 16700 },
      { date: '2026-09-25T14:00:00Z', value: 16750 },
      { date: '2026-09-25T19:30:00Z', value: 16758 },
      // Adjacent by index, 65 hours apart in fact: the axis is a category axis.
      { date: '2026-09-28T13:30:00Z', value: 18890 },
      { date: '2026-09-28T14:00:00Z', value: 18896 },
    ]
    const { container } = render(<PortfolioChart data={week} currency="MXN" />)

    const ticks = tickTexts(container)
    // Two sessions, two marks — not one per point, and not the same date over
    // and over, which is what formatting every value on its own would give.
    expect(ticks).toHaveLength(2)
    expect(ticks[0]).not.toBe(ticks[1])
  })
})
