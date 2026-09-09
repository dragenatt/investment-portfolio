// Notification centre — one inbox for everything the app wants to tell someone.
//
// Two alert tables already exist and neither is this. `alerts` holds per-symbol
// price triggers; `portfolio_alerts` holds concentration warnings. Both are read
// by their own screen, neither can carry "your backtest finished" or "the price
// feed is down", and a user has no single place to look.
//
// The categories come straight from the roadmap:
//
//   portfolio — out of band, drawdown, risk change, concentration
//   market    — an extraordinary move, abnormal volatility, out of range
//   data      — a stale price, a provider down, not enough history
//   system    — a Monte Carlo, backtest or optimisation that finished
//
// Delivery is best-effort: a notification that fails to insert must not fail the
// job that produced it.

import { type SupabaseClient } from '@supabase/supabase-js'

export type NotificationCategory = 'portfolio' | 'market' | 'data' | 'system'
export type NotificationSeverity = 'info' | 'warning' | 'critical'

export type NotificationInput = {
  userId: string
  portfolioId?: string | null
  category: NotificationCategory
  /** Narrower kind within the category — also the deduplication key. */
  kind: string
  severity?: NotificationSeverity
  title: string
  body?: string
  details?: Record<string, unknown>
}

export type NotificationRow = {
  id: string
  portfolio_id: string | null
  category: NotificationCategory
  kind: string
  severity: NotificationSeverity
  title: string
  body: string | null
  details: Record<string, unknown>
  read_at: string | null
  created_at: string
}

/** Postgres unique-violation. The dedupe index makes this the expected outcome. */
const UNIQUE_VIOLATION = '23505'

/**
 * Deliver one notification.
 *
 * A unique index on (user, kind, portfolio, day) makes repeats impossible, so an
 * hourly job cannot deliver the same drawdown warning twenty-four times. Hitting
 * that index is the normal case, not an error — it is swallowed rather than
 * logged, because logging it would make a working system look broken.
 *
 * Returns whether a new row was actually created.
 */
export async function notify(
  supabase: SupabaseClient,
  input: NotificationInput,
): Promise<boolean> {
  const { error } = await supabase.from('notifications').insert({
    user_id: input.userId,
    portfolio_id: input.portfolioId ?? null,
    category: input.category,
    kind: input.kind,
    severity: input.severity ?? 'info',
    title: input.title,
    body: input.body ?? null,
    details: input.details ?? {},
  })

  if (!error) return true
  if (error.code === UNIQUE_VIOLATION) return false

  console.error('[notifications] insert failed:', error.message)
  return false
}

export async function listNotifications(
  supabase: SupabaseClient,
  options: { unreadOnly?: boolean; limit?: number } = {},
): Promise<NotificationRow[]> {
  let query = supabase
    .from('notifications')
    .select('id, portfolio_id, category, kind, severity, title, body, details, read_at, created_at')
    .order('created_at', { ascending: false })
    .limit(Math.min(options.limit ?? 50, 200))

  if (options.unreadOnly) query = query.is('read_at', null)

  const { data, error } = await query
  if (error) {
    console.error('[notifications] read failed:', error.message)
    return []
  }
  return (data ?? []) as NotificationRow[]
}

export async function markRead(
  supabase: SupabaseClient,
  ids: string[],
  read = true,
): Promise<number> {
  if (ids.length === 0) return 0
  const { data, error } = await supabase
    .from('notifications')
    .update({ read_at: read ? new Date().toISOString() : null })
    .in('id', ids)
    .select('id')

  if (error) {
    console.error('[notifications] update failed:', error.message)
    return 0
  }
  return data?.length ?? 0
}

export async function unreadCount(supabase: SupabaseClient): Promise<number> {
  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .is('read_at', null)

  if (error) {
    console.error('[notifications] count failed:', error.message)
    return 0
  }
  return count ?? 0
}

// ─── Builders ───────────────────────────────────────────────────────────────
//
// Pure, so the wording and the severity thresholds are testable without a
// database, and so every producer of a given event phrases it the same way.

/** Depth at which a drawdown stops being noise and becomes news. */
const DRAWDOWN_WARNING_PCT = 10
const DRAWDOWN_CRITICAL_PCT = 20

export function drawdownNotification(
  userId: string,
  portfolioId: string,
  drawdownPct: number,
  recoveryRequiredPct: number | null,
): NotificationInput | null {
  if (!Number.isFinite(drawdownPct) || drawdownPct < DRAWDOWN_WARNING_PCT) return null

  const recovery =
    recoveryRequiredPct === null
      ? ''
      : ` Recovering it needs a gain of ${recoveryRequiredPct.toFixed(1)}%, which is more than the fall because the gain works on a smaller balance.`

  return {
    userId,
    portfolioId,
    category: 'portfolio',
    kind: 'drawdown',
    severity: drawdownPct >= DRAWDOWN_CRITICAL_PCT ? 'critical' : 'warning',
    title: `Your portfolio is ${drawdownPct.toFixed(1)}% below its high`,
    body: `Measured against the highest value this portfolio has reached.${recovery}`,
    details: { drawdownPct, recoveryRequiredPct },
  }
}

export function outOfBandNotification(
  userId: string,
  portfolioId: string,
  symbol: string,
  currentWeightPct: number,
  targetWeightPct: number,
  bandPp: number,
): NotificationInput {
  return {
    userId,
    portfolioId,
    category: 'portfolio',
    kind: `out_of_band:${symbol}`,
    severity: 'warning',
    title: `${symbol} has drifted outside its band`,
    body: `It is now ${currentWeightPct.toFixed(1)}% of the portfolio, against a ${targetWeightPct.toFixed(0)}% target with a ±${bandPp} point band.`,
    details: { symbol, currentWeightPct, targetWeightPct, bandPp },
  }
}

export function staleDataNotification(
  userId: string,
  symbol: string,
  ageDays: number,
): NotificationInput {
  return {
    userId,
    category: 'data',
    kind: `stale_price:${symbol}`,
    severity: ageDays > 7 ? 'critical' : 'warning',
    title: `The price for ${symbol} is ${ageDays} days old`,
    body: 'Anything measured from it describes the past, not today.',
    details: { symbol, ageDays },
  }
}

export function jobFinishedNotification(
  userId: string,
  portfolioId: string | null,
  job: 'montecarlo' | 'backtest' | 'optimisation' | 'stress_test',
  succeeded: boolean,
): NotificationInput {
  const labels: Record<typeof job, string> = {
    montecarlo: 'Monte Carlo simulation',
    backtest: 'Backtest',
    optimisation: 'Optimisation',
    stress_test: 'Stress test',
  }
  return {
    userId,
    portfolioId,
    category: 'system',
    kind: `${job}_${succeeded ? 'done' : 'failed'}`,
    severity: succeeded ? 'info' : 'warning',
    title: succeeded ? `${labels[job]} finished` : `${labels[job]} could not finish`,
    body: succeeded
      ? 'The results are ready to look at.'
      : 'Nothing was saved. Try again, or check that the holdings have enough price history.',
    details: { job, succeeded },
  }
}
