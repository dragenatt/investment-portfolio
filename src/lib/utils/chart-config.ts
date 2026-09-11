// The one place chart colour and chrome are decided.
//
// Before this, the shared palette here was six literal hexes (#D97706, #4D7C0F,
// …) and six chart components had hardcoded more of their own on top: drawdown
// was #ef4444, Monte Carlo #D97706/#B45309, the price chart carried five. None
// of them changed in dark mode, none had been checked for colour-vision
// separation, and nothing stopped a seventh chart inventing a seventh red.
//
// ── How the palette was chosen ──────────────────────────────────────────────
//
// Eight hues in FIXED order, assigned in sequence and never cycled. The order is
// the colour-vision-safety mechanism, so it does not change, and a ninth series
// is never a generated hue — it folds into "Other" or the chart facets.
//
// Green and red are deliberately absent. This is a finance app: they already
// mean gain and loss on every screen, and a factor loading or an allocation
// slice painted green would read as "good" when it means nothing of the sort.
// Status keeps --gain/--loss/--good/--bad; identity uses --chart-1..8.
//
// The palette was validated rather than eyeballed — OKLab dE with the
// Machado-Oliveira-Fernandes 2009 CVD simulation at severity 1.0, in both modes,
// against the real card surfaces (#FFFFFF light, #16181C dark). All checks pass
// in both: worst adjacent pair dE 10.1 under deuteranopia, normal-vision floor
// 19.8, every slot inside its lightness band, chroma >= 0.1, contrast >= 3:1.
// The same steps validate in both modes, which was CHECKED, not assumed.
//
// Definitions live in globals.css. Nothing here holds a literal colour, which is
// what makes the light/dark pair a single decision instead of two.

/** Fixed order. Index 0 is the first series, and there is no ninth. */
export const SERIES_PALETTE = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
  'var(--chart-6)',
  'var(--chart-7)',
  'var(--chart-8)',
] as const

/**
 * Scatter, bubble and small-multiple forms cap here.
 *
 * In those forms any two marks can end up side by side, so they need all-pairs
 * separation rather than adjacent-pairs. Only the first three slots have it
 * (worst all-pairs dE 13.8, both modes). Beyond three: fold into "Other",
 * facet, or change the form — never add a hue.
 */
export const SCATTER_SERIES_CAP = 3

/** The colour for a series at `index`, or null when the palette is exhausted. */
export function seriesColor(index: number): string | null {
  if (!Number.isInteger(index) || index < 0 || index >= SERIES_PALETTE.length) return null
  return SERIES_PALETTE[index]
}

/**
 * Pin a colour to each series key.
 *
 * Keyed rather than indexed on purpose: colour follows the entity, never its
 * rank. A filter that drops one series must not repaint the survivors, and
 * passing the previous assignment back in is what guarantees that.
 *
 * A key past the eighth is left out rather than given a reused colour. Two
 * entities sharing a colour is the exact failure the fixed order prevents.
 */
export function assignSeriesColors(
  keys: string[],
  existing: Record<string, string> = {},
): Record<string, string> {
  const result: Record<string, string> = {}
  const taken = new Set<string>()

  for (const key of keys) {
    const previous = existing[key]
    if (previous && !taken.has(previous)) {
      result[key] = previous
      taken.add(previous)
    }
  }

  for (const key of keys) {
    if (result[key]) continue
    const free = SERIES_PALETTE.find((colour) => !taken.has(colour))
    if (!free) continue
    result[key] = free
    taken.add(free)
  }

  return result
}

export type FoldedSeries<T> = {
  kept: T[]
  otherValue: number
  otherCount: number
}

/**
 * Reduce a list to what the palette can carry, summing the tail into "Other".
 *
 * The cap counts "Other" as one of its slots, so the rendered series never
 * exceeds it. The total is preserved, which is what makes this safe for a
 * percentage breakdown: folding must not quietly lose a few points.
 */
export function foldToSeriesCap<T>(
  rows: T[],
  valueOf: (row: T) => number,
  cap: number = SERIES_PALETTE.length,
): FoldedSeries<T> {
  if (rows.length === 0 || cap < 1) return { kept: [], otherValue: 0, otherCount: 0 }
  if (rows.length <= cap) return { kept: [...rows], otherValue: 0, otherCount: 0 }

  const ordered = [...rows].sort((a, b) => {
    const left = valueOf(b)
    const right = valueOf(a)
    return (Number.isFinite(left) ? left : 0) - (Number.isFinite(right) ? right : 0)
  })

  // One slot is spent on "Other", so only cap - 1 real series survive.
  const kept = ordered.slice(0, cap - 1)
  const folded = ordered.slice(cap - 1)

  let otherValue = 0
  for (const row of folded) {
    const value = valueOf(row)
    // A non-finite value must not poison the sum; it is dropped, and the count
    // still reports it so the interface can say the total is short.
    if (Number.isFinite(value)) otherValue += value
  }

  return { kept, otherValue, otherCount: folded.length }
}

// ── Chrome ──────────────────────────────────────────────────────────────────
// Grid and axes are recessive: they orient the eye and then get out of the way.
// Everything below is a token, so a theme change moves every chart at once.

export const CHART_INK = {
  grid: 'var(--border)',
  axis: 'var(--muted-foreground)',
  surface: 'var(--card)',
  crosshair: 'var(--muted-foreground)',
  gain: 'var(--gain)',
  loss: 'var(--loss)',
} as const

/** Data-line weight. One value, so no chart is accidentally heavier than another. */
export const LINE_WIDTH = 2
/** Markers need to be big enough to hit, not just to see. */
export const DOT_RADIUS = 4
export const ACTIVE_DOT_RADIUS = 5
/** A ring in the surface colour keeps overlapping marks readable. */
export const MARK_RING_WIDTH = 2

/**
 * Shared Recharts props.
 *
 * Kept as a factory rather than a constant because the call sites already use
 * it that way, and changing ten components to read a constant would be churn
 * with no gain.
 */
export function getChartTheme() {
  return {
    xAxis: {
      tick: { fontSize: 11, fill: CHART_INK.axis } as Record<string, unknown>,
      tickLine: false as const,
      axisLine: false as const,
      stroke: CHART_INK.axis,
    },
    yAxis: {
      tick: { fontSize: 11, fill: CHART_INK.axis } as Record<string, unknown>,
      tickLine: false as const,
      axisLine: false as const,
      stroke: CHART_INK.axis,
      width: 60,
    },
    grid: {
      stroke: CHART_INK.grid,
      strokeDasharray: '3 3',
      vertical: false as const,
    },
    /** Crosshair for line and area charts. Dashed so it never reads as data. */
    crosshair: {
      stroke: CHART_INK.crosshair,
      strokeWidth: 1,
      strokeDasharray: '4 4',
    },
    colors: {
      primary: SERIES_PALETTE[0],
      // Semantic, not categorical. These two keep their meaning everywhere.
      positive: CHART_INK.gain,
      negative: CHART_INK.loss,
      palette: SERIES_PALETTE,
      /** A benchmark is another series; it draws from the same fixed order. */
      benchmarks: SERIES_PALETTE,
    },
  } as const
}

/** Helper to format axis tick values */
export function formatAxisTick(
  value: number,
  type: 'currency' | 'percent' | 'number',
): string {
  switch (type) {
    case 'currency':
      return `$${value.toLocaleString()}`
    case 'percent':
      return `${value}%`
    case 'number':
      return value.toLocaleString()
  }
}

// Re-export a convenience type for the theme object
export type ChartTheme = ReturnType<typeof getChartTheme>
