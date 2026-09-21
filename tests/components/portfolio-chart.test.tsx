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
})
