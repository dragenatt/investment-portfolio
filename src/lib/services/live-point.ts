// The last point of the value chart, from the live prices — pure, no I/O.
//
// The chart's daily ranges are drawn from stored closes, and a session's close
// is stored only once it has settled (price-history.ts: 22:00 UTC). Until then
// the route values "today" at the previous close. For a book a few days old the
// 1M, 3M, 1Y and MAX ranges were two points with the same value — a flat line
// sitting under a header that moved with every quote — and on any book, the
// line never showed the day in progress.
//
// The header above the chart already has today's value, from the same live
// prices every other figure on the dashboard uses. The chart ends there.

export type SeriesPoint = { date: string; value: number }

/**
 * `series` with its present replaced by `live`.
 *
 * Daily series ("YYYY-MM-DD") drop any point dated today (UTC, the route's
 * calendar) and end at today's live value. Intraday series (ISO instants) end
 * at `now`. An empty series stays empty — one live point is not a history —
 * and a missing or non-positive live value changes nothing.
 */
export function withLivePoint(series: SeriesPoint[], live: number | null | undefined, now: Date = new Date()): SeriesPoint[] {
  if (series.length === 0 || live == null || !Number.isFinite(live) || live <= 0) return series

  const intraday = series.some((point) => point.date.includes('T'))
  const at = intraday ? now.toISOString() : now.toISOString().slice(0, 10)
  return [...series.filter((point) => point.date < at), { date: at, value: live }]
}
