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
 *
 * The calendar is computed from the exchange's own rules rather than listed by
 * hand. A list has to be extended every year, and the year it runs out the
 * dashboard says "open" on Christmas morning and nobody notices until someone
 * looks. What no rule can predict — a closure for a day of national mourning —
 * is not modelled either way.
 */

/** 0 = Sunday. */
type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6

/** A calendar date as YYYY-MM-DD. Days outside the month roll over. */
function day(year: number, month: number, date: number): string {
  return new Date(Date.UTC(year, month - 1, date)).toISOString().slice(0, 10)
}

function weekdayOf(year: number, month: number, date: number): Weekday {
  return new Date(Date.UTC(year, month - 1, date)).getUTCDay() as Weekday
}

/** The day of the month of the nth given weekday — the third Monday, and such. */
function nthWeekdayDate(year: number, month: number, weekday: Weekday, n: number): number {
  return 1 + ((weekday - weekdayOf(year, month, 1) + 7) % 7) + (n - 1) * 7
}

/** The nth given weekday of a month — nthWeekday(2026, 1, 1, 3) is the third Monday. */
function nthWeekday(year: number, month: number, weekday: Weekday, n: number): string {
  return day(year, month, nthWeekdayDate(year, month, weekday, n))
}

/** The last given weekday of a month, for Memorial Day. */
function lastWeekday(year: number, month: number, weekday: Weekday): string {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const from = weekdayOf(year, month, last)
  return day(year, month, last - ((from - weekday + 7) % 7))
}

/**
 * A fixed-date holiday as the exchange observes it: a Saturday one closes the
 * Friday before, a Sunday one the Monday after.
 */
function observed(year: number, month: number, date: number): string {
  const weekday = weekdayOf(year, month, date)
  if (weekday === 6) return day(year, month, date - 1)
  if (weekday === 0) return day(year, month, date + 1)
  return day(year, month, date)
}

/** Gregorian Easter Sunday (Meeus/Jones/Butcher); Good Friday is two days before. */
function easter(year: number): { month: number; date: number } {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const n = h + l - 7 * m + 114
  return { month: Math.floor(n / 31), date: (n % 31) + 1 }
}

/**
 * The exchange's full-day closures in a year (nyse.com holiday calendar).
 *
 * Juneteenth has been one since 2022; nothing here reaches further back than
 * the day it is asked about.
 */
function holidaysFor(year: number): Set<string> {
  const days = new Set<string>()

  // New Year's Day, the one holiday a Saturday does not move: the exchange
  // trades the Friday before it as a normal day.
  const january1 = weekdayOf(year, 1, 1)
  if (january1 !== 6) days.add(january1 === 0 ? day(year, 1, 2) : day(year, 1, 1))

  days.add(nthWeekday(year, 1, 1, 3)) // Martin Luther King Jr. Day
  days.add(nthWeekday(year, 2, 1, 3)) // Washington's Birthday

  const { month, date } = easter(year)
  days.add(day(year, month, date - 2)) // Good Friday

  days.add(lastWeekday(year, 5, 1)) // Memorial Day
  days.add(observed(year, 6, 19)) // Juneteenth
  days.add(observed(year, 7, 4)) // Independence Day
  days.add(nthWeekday(year, 9, 1, 1)) // Labor Day
  days.add(nthWeekday(year, 11, 4, 4)) // Thanksgiving
  days.add(observed(year, 12, 25)) // Christmas

  return days
}

/** The exchange's 13:00 closes: the day after Thanksgiving, July 3, Christmas Eve. */
function earlyClosesFor(year: number, holidays: Set<string>): Set<string> {
  const closes = new Set<string>()

  closes.add(day(year, 11, nthWeekdayDate(year, 11, 4, 4) + 1))

  // Both only when they are trading days at all: a weekday, and not the day the
  // holiday itself moved onto (July 4 on a Saturday closes July 3 outright).
  for (const [month, date] of [[7, 3], [12, 24]]) {
    const weekday = weekdayOf(year, month, date)
    const which = day(year, month, date)
    if (weekday !== 0 && weekday !== 6 && !holidays.has(which)) closes.add(which)
  }

  return closes
}

/** One year's calendar, worked out once. */
const calendars = new Map<number, { holidays: Set<string>; earlyCloses: Set<string> }>()

function calendarFor(year: number) {
  const cached = calendars.get(year)
  if (cached) return cached
  const holidays = holidaysFor(year)
  const calendar = { holidays, earlyCloses: earlyClosesFor(year, holidays) }
  calendars.set(year, calendar)
  return calendar
}

/** Exported for the tests, which check the computed calendar against nyse.com. */
export function usMarketCalendar(year: number): { holidays: string[]; earlyCloses: string[] } {
  const { holidays, earlyCloses } = calendarFor(year)
  return { holidays: [...holidays].sort(), earlyCloses: [...earlyCloses].sort() }
}

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
  const { holidays, earlyCloses } = calendarFor(Number(date.slice(0, 4)))
  if (holidays.has(date)) return 'holiday'
  const close = earlyCloses.has(date) ? EARLY_CLOSE_MINUTE : CLOSE_MINUTE
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
