// Drawdown analysis — pure functions, no I/O.
//
// A single "max drawdown" number tells a reader how deep the worst hole was and
// nothing about how long they would have sat in it. The recovery is usually the
// part that decides whether someone actually holds on, so this module reports
// each episode with its decline, its trough and its climb back out — and leaves
// an episode open when the climb has not happened yet.

export type ValuePoint = { date: string; value: number }

export type DrawdownEpisode = {
  peakDate: string
  troughDate: string
  /** Date the series regained its old peak. Null while still underwater. */
  recoveryDate: string | null
  peakValue: number
  troughValue: number
  /** Positive percentage: 20 means the book fell a fifth. */
  depthPct: number
  /** Calendar days from peak to trough. */
  declineDays: number
  /** Calendar days from trough back to the old peak. Null while underwater. */
  recoveryDays: number | null
  recovered: boolean
}

export type DrawdownAnalysis = {
  maxDrawdownPct: number
  currentDrawdownPct: number
  /** Gain needed to climb out of the current hole. */
  recoveryRequiredPct: number
  averageDrawdownPct: number
  longestRecoveryDays: number | null
  worstEpisode: DrawdownEpisode | null
  episodes: DrawdownEpisode[]
  /** Zero at every running peak, negative underneath it. */
  underwater: Array<{ date: string; pct: number }>
}

function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`)
  const b = Date.parse(`${to}T00:00:00Z`)
  if (Number.isNaN(a) || Number.isNaN(b)) return 0
  return Math.round((b - a) / 86_400_000)
}

/**
 * The gain needed to undo a fall, which is always larger than the fall.
 *
 * A -23% drawdown needs +29.9%, not +23%, because the gain works on the smaller
 * remaining balance. This asymmetry is the single most useful thing to show a
 * learner about losses. Returns null for a total loss, which nothing recovers.
 */
export function recoveryRequired(drawdownPct: number): number | null {
  if (!Number.isFinite(drawdownPct) || drawdownPct < 0 || drawdownPct >= 100) return null
  if (drawdownPct === 0) return 0
  const remaining = 1 - drawdownPct / 100
  return (1 / remaining - 1) * 100
}

const EMPTY: DrawdownAnalysis = {
  maxDrawdownPct: 0,
  currentDrawdownPct: 0,
  recoveryRequiredPct: 0,
  averageDrawdownPct: 0,
  longestRecoveryDays: null,
  worstEpisode: null,
  episodes: [],
  underwater: [],
}

/**
 * Walk a value series and pull out every drawdown episode.
 *
 * An episode opens the first time the series falls below a running peak, deepens
 * while it keeps falling, and closes when the old peak is regained. The last
 * episode stays open when the series ends underwater — reporting it as recovered
 * would be the one lie a drawdown chart must never tell.
 */
export function analyseDrawdowns(points: ValuePoint[]): DrawdownAnalysis {
  const usable = points.filter((p) => Number.isFinite(p.value) && p.value > 0)
  if (usable.length === 0) return { ...EMPTY }

  const sorted = [...usable].sort((a, b) => a.date.localeCompare(b.date))

  const episodes: DrawdownEpisode[] = []
  const underwater: Array<{ date: string; pct: number }> = []

  let peakValue = sorted[0].value
  let peakDate = sorted[0].date
  let open: DrawdownEpisode | null = null

  for (const point of sorted) {
    if (point.value >= peakValue) {
      // New high: any open episode has just recovered.
      if (open) {
        open.recoveryDate = point.date
        open.recoveryDays = daysBetween(open.troughDate, point.date)
        open.recovered = true
        episodes.push(open)
        open = null
      }
      peakValue = point.value
      peakDate = point.date
      underwater.push({ date: point.date, pct: 0 })
      continue
    }

    const depthPct = ((peakValue - point.value) / peakValue) * 100
    underwater.push({ date: point.date, pct: -depthPct })

    if (!open) {
      open = {
        peakDate,
        troughDate: point.date,
        recoveryDate: null,
        peakValue,
        troughValue: point.value,
        depthPct,
        declineDays: daysBetween(peakDate, point.date),
        recoveryDays: null,
        recovered: false,
      }
    } else if (point.value < open.troughValue) {
      open.troughValue = point.value
      open.troughDate = point.date
      open.depthPct = depthPct
      open.declineDays = daysBetween(open.peakDate, point.date)
    }
  }

  if (open) episodes.push(open)

  const last = sorted[sorted.length - 1]
  const currentDrawdownPct =
    last.value >= peakValue ? 0 : ((peakValue - last.value) / peakValue) * 100

  const worstEpisode =
    episodes.length === 0
      ? null
      : episodes.reduce((worst, e) => (e.depthPct > worst.depthPct ? e : worst))

  const recoveries = episodes
    .map((e) => e.recoveryDays)
    .filter((d): d is number => d !== null)

  return {
    maxDrawdownPct: worstEpisode?.depthPct ?? 0,
    currentDrawdownPct,
    recoveryRequiredPct: recoveryRequired(currentDrawdownPct) ?? 0,
    averageDrawdownPct:
      episodes.length === 0
        ? 0
        : episodes.reduce((sum, e) => sum + e.depthPct, 0) / episodes.length,
    longestRecoveryDays: recoveries.length === 0 ? null : Math.max(...recoveries),
    worstEpisode,
    episodes,
    underwater,
  }
}
