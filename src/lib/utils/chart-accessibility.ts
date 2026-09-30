// Text alternatives for charts (C5, WCAG 1.1.1). No I/O, no React.
//
// Every chart gets a one-sentence summary for screen readers and, where it
// plots data rather than decorating a number already on screen, a table of the
// same data that anyone can open. Long series are sampled evenly — first and
// last points always kept — so a two-year daily history is a table someone can
// read, and the table says it was sampled.

export type ChartTable = {
  /** Read by screen readers as the table's name. */
  caption: string
  columns: string[]
  /** First cell of each row is the row header (a date, a name). */
  rows: string[][]
  /** Shown under the table, e.g. that rows were sampled. */
  note?: string
}

export const MAX_TABLE_ROWS = 60

/** At most `max` rows, evenly spaced, always including the first and last. */
export function sampleEvenly<T>(rows: readonly T[], max = MAX_TABLE_ROWS): { rows: T[]; sampled: boolean } {
  if (max < 2 || rows.length <= max) return { rows: [...rows], sampled: false }
  const out: T[] = []
  const step = (rows.length - 1) / (max - 1)
  let previous = -1
  for (let i = 0; i < max; i++) {
    const index = Math.round(i * step)
    if (index !== previous) out.push(rows[index])
    previous = index
  }
  return { rows: out, sampled: true }
}

export function sampledNote(shown: number, total: number): string | undefined {
  return shown < total ? `Se muestran ${shown} de ${total} puntos, espaciados de forma regular.` : undefined
}

const DATE_FORMAT = new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

/** "14 sep 2026" for an ISO date or timestamp; the input unchanged if it is not one. */
export function formatChartDate(value: string | number | Date): string {
  // V8 parses almost any string as a date ("Semana 3" is 1 Mar 2001), so only
  // ISO dates are treated as dates.
  if (typeof value === 'string' && !/^\d{4}-\d{2}-\d{2}/.test(value)) return value
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : DATE_FORMAT.format(date)
}

/**
 * "14 sep 2026" for a date, "14 sep, 9:35 a.m." for an instant.
 *
 * Intraday points carry a time, and a chart of one session whose every label
 * reads the same date tells the reader nothing about where on the line they
 * are. The time is shown on the reader's own clock — an instant is when THEY
 * were watching the market — while plain dates stay in UTC, where a date with
 * no time is a label rather than a moment.
 */
const MOMENT_FORMAT = new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

export function formatChartMoment(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T/.test(value)) return formatChartDate(value)
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : MOMENT_FORMAT.format(date)
}

/** Whether a series is made of instants rather than dates. */
export function isIntradaySeries(points: Array<{ date: string }>): boolean {
  return points.length > 0 && points.every((p) => /^\d{4}-\d{2}-\d{2}T/.test(p.date))
}

/** Pass an empty currency when the chart's own labels show none. */
export function formatChartMoney(value: number, currency = 'USD'): string {
  if (!Number.isFinite(value)) return '—'
  const amount = `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  return currency ? `${amount} ${currency}` : amount
}

export function formatChartPercent(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return '—'
  return `${value.toFixed(decimals)}%`
}

export function formatChartNumber(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return '—'
  return value.toLocaleString('es-MX', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

/**
 * "de $1,000.00 USD el 1 ago 2026 a $1,200.00 USD el 14 sep 2026, un alza de 20.00%".
 * The direction is said in words: colour is not the only carrier of gain or loss.
 */
export function describeChange(
  first: { label: string; value: number },
  last: { label: string; value: number },
  format: (value: number) => string,
  { percent = true }: { percent?: boolean } = {},
): string {
  const base = `de ${format(first.value)} el ${first.label} a ${format(last.value)} el ${last.label}`
  // A portfolio's value moves with deposits and withdrawals too; a percentage
  // of it would read as a return. Charts of such values pass percent: false.
  if (!percent) return base
  if (!Number.isFinite(first.value) || !Number.isFinite(last.value) || first.value === 0) return base
  const change = ((last.value - first.value) / Math.abs(first.value)) * 100
  if (Math.abs(change) < 0.005) return `${base}, sin cambio`
  return `${base}, ${change > 0 ? 'un alza' : 'una baja'} de ${Math.abs(change).toFixed(2)}%`
}

/** Build a table from points, sampling long series and noting it. */
export function seriesTable<T>(
  points: readonly T[],
  caption: string,
  columns: string[],
  toRow: (point: T) => string[],
  max = MAX_TABLE_ROWS,
): ChartTable {
  const { rows } = sampleEvenly(points, max)
  return { caption, columns, rows: rows.map(toRow), note: sampledNote(rows.length, points.length) }
}

/**
 * The labels for a time axis, one per point, blank where none should be drawn.
 *
 * A portfolio series is plotted on a category axis, which spaces points evenly
 * by index. That is deliberate for intraday data — collapsing the hours the
 * market is shut is what every trading chart does — but it means consecutive
 * points can be thirty minutes or a whole weekend apart, so the axis cannot be
 * labelled by formatting each value on its own: a multi-day window would repeat
 * one date a dozen times and then skip two days with nothing to mark it.
 *
 * So a multi-day intraday series is labelled only where the day changes. One
 * mark per session, sitting exactly where a gap is, which is what lets a reader
 * see that a step happened across a weekend rather than within a morning.
 * A window inside one session is labelled by the clock, and a series of closing
 * prices by its dates.
 */
export function timeAxisLabels(points: Array<{ date: string }>): string[] {
  if (points.length === 0) return []

  const intraday = isIntradaySeries(points)
  const day = (value: string) => value.slice(0, 10)
  const singleDay = intraday && points.every((p) => day(p.date) === day(points[0].date))

  return points.map((point, index) => {
    const value = point.date
    if (typeof value !== 'string') return ''

    if (singleDay) {
      const at = new Date(value)
      // The same clock the tooltip reads on, deliberately: an axis saying
      // "13:30" under a tooltip saying "1:30 p.m." makes the reader work out
      // that they are the same instant. `numeric` rather than `2-digit` because
      // es-MX renders the latter as "01:30 p.m.", too wide for a tick.
      return Number.isNaN(at.getTime())
        ? ''
        : at.toLocaleTimeString('es-MX', { hour: 'numeric', minute: '2-digit' })
    }

    if (intraday && index > 0 && day(points[index - 1].date) === day(value)) return ''

    // A plain date carries no time, so it is read in UTC: shifting it into the
    // reader's zone would move "1 sep" to the previous evening west of London.
    const at = new Date(intraday ? value : `${day(value)}T00:00:00Z`)
    if (Number.isNaN(at.getTime())) return ''
    return at.toLocaleDateString('es-MX', {
      day: 'numeric',
      month: 'short',
      ...(intraday ? {} : { timeZone: 'UTC' }),
    })
  })
}
