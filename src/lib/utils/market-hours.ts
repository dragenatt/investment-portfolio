/**
 * Whether the US stock market (NYSE/Nasdaq) is in its regular session — pure,
 * no I/O.
 *
 * The dashboard's prices refresh every 15 seconds, and a reader looking at a
 * number that has not moved cannot tell a quiet minute from a closed market or
 * a broken feed. This says which: the session in New York time, 9:30 to 16:00
 * on weekdays, closed on the exchange's holidays, 13:00 on its early-close
 * days. Scope is the US session only: it is what most holdings trade on, and
 * other exchanges' calendars are not modelled here.
 */

/** NYSE full-day holidays (nyse.com holiday calendar). Extend each year. */
const HOLIDAYS = new Set([
  // 2026
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25',
  '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
  // 2027
  '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31',
  '2027-06-18', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24',
])

/** NYSE early closes, 13:00 New York. */
const EARLY_CLOSES = new Set(['2026-11-27', '2026-12-24', '2027-11-26'])

const OPEN_MINUTE = 9 * 60 + 30
const CLOSE_MINUTE = 16 * 60
const EARLY_CLOSE_MINUTE = 13 * 60

export type UsMarketState = 'open' | 'closed' | 'weekend' | 'holiday'

const NEW_YORK = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

/** The date, weekday and minute of the day in New York at `at`. */
function newYorkClock(at: Date): { date: string; weekday: string; minute: number } {
  const parts = Object.fromEntries(NEW_YORK.formatToParts(at).map((p) => [p.type, p.value]))
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: parts.weekday,
    minute: Number(parts.hour) * 60 + Number(parts.minute),
  }
}

export function usMarketState(at: Date = new Date()): UsMarketState {
  const { date, weekday, minute } = newYorkClock(at)
  if (weekday === 'Sat' || weekday === 'Sun') return 'weekend'
  if (HOLIDAYS.has(date)) return 'holiday'
  const close = EARLY_CLOSES.has(date) ? EARLY_CLOSE_MINUTE : CLOSE_MINUTE
  return minute >= OPEN_MINUTE && minute < close ? 'open' : 'closed'
}

/** How long ago an instant was, in the largest sensible unit, for a "hace 8 s" label. */
export function elapsed(then: number, now: number): { n: number; unit: 's' | 'min' | 'h' } {
  const seconds = Math.max(0, Math.round((now - then) / 1000))
  if (seconds < 60) return { n: seconds, unit: 's' }
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return { n: minutes, unit: 'min' }
  return { n: Math.floor(minutes / 60), unit: 'h' }
}
