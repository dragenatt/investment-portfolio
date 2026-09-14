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
