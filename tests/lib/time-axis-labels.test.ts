import { describe, it, expect } from 'vitest'
import { timeAxisLabels } from '@/lib/utils/chart-accessibility'

/**
 * The portfolio chart's axis was hidden entirely, so a week of trading was a
 * shape with no time under it: the reader could see a vertical step and had no
 * way to tell it happened across a weekend rather than inside a morning.
 *
 * Labelling it is not "format every value", because the axis is a category axis
 * and the intraday grid holds only instants the market printed. These pin the
 * two things that makes non-obvious: one label per session on a multi-day
 * window, and the clock on a single one.
 */

const at = (iso: string) => ({ date: iso })

describe('timeAxisLabels', () => {
  it('labels a single session by the clock', () => {
    const labels = timeAxisLabels([
      at('2026-09-28T13:30:00Z'),
      at('2026-09-28T14:00:00Z'),
      at('2026-09-28T14:30:00Z'),
    ])
    expect(labels).toHaveLength(3)
    // Rendered on the reader's own clock, so assert the shape, not the hour.
    // The 12-hour form is the one the tooltip uses; the axis matches it on
    // purpose, so a tick and a tooltip never describe one instant two ways.
    for (const label of labels) expect(label).toMatch(/^\d{1,2}:\d{2}(\s| )?(a\.m\.|p\.m\.)$/)
    // Every point carries one: within a session there is nothing to collapse.
    expect(labels.filter(Boolean)).toHaveLength(3)
  })

  it('labels a multi-day intraday window once per session, at the point that opens it', () => {
    const labels = timeAxisLabels([
      at('2026-09-25T13:30:00Z'),
      at('2026-09-25T14:00:00Z'),
      at('2026-09-25T19:30:00Z'),
      // The weekend. Adjacent by index, 65 hours apart in fact.
      at('2026-09-28T13:30:00Z'),
      at('2026-09-28T14:00:00Z'),
    ])

    expect(labels[0]).not.toBe('')
    expect(labels[1]).toBe('')
    expect(labels[2]).toBe('')
    // The mark lands exactly on the gap, which is the whole point: it is what
    // tells the reader the step in the line crossed a weekend.
    expect(labels[3]).not.toBe('')
    expect(labels[4]).toBe('')

    expect(labels[0]).not.toBe(labels[3])
  })

  it('does not repeat a date across a session', () => {
    const sameDay = Array.from({ length: 12 }, (_, i) =>
      at(`2026-09-28T${String(13 + i).padStart(2, '0')}:00:00Z`),
    )
    const labels = timeAxisLabels([at('2026-09-25T19:30:00Z'), ...sameDay])
    // One for the 25th, one for the 28th, and nothing else: without the
    // collapsing this would print the same date twelve times over.
    expect(labels.filter(Boolean)).toHaveLength(2)
  })

  it('labels closing prices by date, read in UTC', () => {
    const labels = timeAxisLabels([at('2026-09-01'), at('2026-09-02'), at('2026-09-03')])
    expect(labels.filter(Boolean)).toHaveLength(3)
    // A plain date has no time, so it must not be shifted into the reader's
    // zone — west of London that moves "1 sep" onto the previous evening.
    expect(labels[0]).toContain('1')
    expect(labels[0]).not.toBe(labels[1])
  })

  it('survives an empty series and an unparseable instant', () => {
    expect(timeAxisLabels([])).toEqual([])
    expect(timeAxisLabels([at('no-es-una-fecha')])).toEqual([''])
  })
})
