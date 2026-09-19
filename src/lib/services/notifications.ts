// Notification centre — one inbox for everything the app wants to tell someone.
//
// Two alert tables already exist and neither is this. `alerts` holds per-symbol
// price triggers; `portfolio_alerts` holds concentration warnings. Both are read
// by their own screen, neither can carry "your backtest finished" or "the price
// history stopped updating", and a user has no single place to look.
//
// The categories come straight from the roadmap:
//
//   portfolio — drawdown, concentration
//   market    — a price alert that fired, an extraordinary move in a holding
//   data      — a price history that stopped updating
//   system    — a Monte Carlo, backtest, optimisation or stress test that ended
//
// Producers are the background work that already exists — the analytics job
// runner and the nightly cron — not a parallel scheduler (4.5).
//
// Delivery is best-effort and goes through the service role: the table grants
// users SELECT, UPDATE (read/unread) and DELETE on their own rows, and no
// INSERT, so a notification cannot be forged from a browser. A notification
// that fails to insert must not fail the job that produced it.

import { type SupabaseClient } from '@supabase/supabase-js'
import { serviceRoleClient } from '@/lib/supabase/admin'

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
 * How long a notification keeps a repeat of itself from being sent.
 *
 * The unique index stops two of the same kind on one day; it does not stop the
 * nightly job from repeating a standing condition every night. A concentration
 * that is still there tomorrow is not news tomorrow — read or not, the reader
 * was told this week. Once the week is out, a condition that persists is worth
 * saying again.
 */
export const QUIET_DAYS = 7

const repeatKey = (userId: string, portfolioId: string | null | undefined, kind: string) =>
  `${userId}|${portfolioId ?? ''}|${kind}`

/**
 * The inputs worth sending, given what was already sent inside the quiet
 * window. Pure, so the "do not nag" rule is testable without a database.
 */
export function withoutRepeats(
  inputs: NotificationInput[],
  recent: Array<{ user_id: string; portfolio_id: string | null; kind: string }>,
): NotificationInput[] {
  const waiting = new Set(recent.map((row) => repeatKey(row.user_id, row.portfolio_id, row.kind)))
  const seen = new Set<string>()
  return inputs.filter((input) => {
    const key = repeatKey(input.userId, input.portfolioId, input.kind)
    if (waiting.has(key) || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export type DeliveryResult = { delivered: number; suppressed: number; failed: number }

/**
 * Deliver notifications, skipping any whose twin went out in the last week.
 *
 * Inserted one at a time so a duplicate for today — the unique index on
 * (user, kind, portfolio, day) — costs that one row and not the batch. Hitting
 * that index is the normal case, not an error, so it counts as suppressed.
 */
export async function deliverNotifications(
  inputs: NotificationInput[],
  options: { writer?: SupabaseClient | null; now?: Date } = {},
): Promise<DeliveryResult> {
  const result: DeliveryResult = { delivered: 0, suppressed: 0, failed: 0 }
  if (inputs.length === 0) return result
  const writer = options.writer === undefined ? serviceRoleClient() : options.writer
  if (!writer) {
    console.error('[notifications] no service-role client; nothing delivered')
    return { ...result, failed: inputs.length }
  }

  const now = options.now ?? new Date()
  const since = new Date(now.getTime() - QUIET_DAYS * 86_400_000).toISOString()
  const users = [...new Set(inputs.map((i) => i.userId))]
  const { data: recent } = await writer
    .from('notifications')
    .select('user_id, portfolio_id, kind')
    .in('user_id', users)
    .gte('created_at', since)

  const toSend = withoutRepeats(inputs, (recent ?? []) as Array<{ user_id: string; portfolio_id: string | null; kind: string }>)
  result.suppressed = inputs.length - toSend.length

  for (const input of toSend) {
    const { error } = await writer.from('notifications').insert({
      user_id: input.userId,
      portfolio_id: input.portfolioId ?? null,
      category: input.category,
      kind: input.kind,
      severity: input.severity ?? 'info',
      title: input.title,
      body: input.body ?? null,
      details: input.details ?? {},
    })
    if (!error) result.delivered++
    else if (error.code === UNIQUE_VIOLATION) result.suppressed++
    else {
      result.failed++
      console.error('[notifications] insert failed:', error.message)
    }
  }
  return result
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
// They are rendered as-is, so they speak Spanish.

const pct = (value: number, digits = 1) => `${value.toFixed(digits)}%`

/** Depth at which a drawdown stops being noise and becomes news. */
const DRAWDOWN_WARNING_PCT = 10
const DRAWDOWN_CRITICAL_PCT = 20

export function drawdownNotification(
  userId: string,
  portfolioId: string,
  drawdownPct: number,
  recoveryRequiredPct: number | null,
  portfolioName?: string,
): NotificationInput | null {
  if (!Number.isFinite(drawdownPct) || drawdownPct < DRAWDOWN_WARNING_PCT) return null

  const recovery =
    recoveryRequiredPct === null
      ? ''
      : ` Recuperarlo requiere una ganancia de ${pct(recoveryRequiredPct)}, más que la caída, porque la ganancia trabaja sobre un saldo menor.`

  return {
    userId,
    portfolioId,
    category: 'portfolio',
    kind: 'drawdown',
    severity: drawdownPct >= DRAWDOWN_CRITICAL_PCT ? 'critical' : 'warning',
    title: `${portfolioName ?? 'Tu portafolio'} está ${pct(drawdownPct)} por debajo de su máximo`,
    body: `Medido repreciando el último año con las posiciones que tiene hoy, así que aportaciones y retiros no la mueven.${recovery}`,
    details: { drawdownPct, recoveryRequiredPct, method: 'currentWeights' },
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
    title: `${symbol} se salió de su banda`,
    body: `Ahora es ${pct(currentWeightPct)} del portafolio, contra un objetivo de ${targetWeightPct.toFixed(0)}% con una banda de ±${bandPp} puntos.`,
    details: { symbol, currentWeightPct, targetWeightPct, bandPp },
  }
}

/** A concentration finding, as concentration.ts reports it. */
export type ConcentrationFinding = {
  alert_type: string
  severity: 'warning' | 'critical'
  message: string
  details: Record<string, unknown>
}

export function concentrationNotification(
  userId: string,
  portfolioId: string,
  finding: ConcentrationFinding,
  portfolioName?: string,
): NotificationInput {
  const subject = String(finding.details.symbol ?? finding.details.sector ?? finding.details.asset_type ?? '')
  return {
    userId,
    portfolioId,
    category: 'portfolio',
    kind: `concentration:${finding.alert_type}:${subject}`,
    severity: finding.severity,
    title: `Concentración en ${portfolioName ?? 'tu portafolio'}`,
    body: `${finding.message}. Un solo evento sobre esa parte movería el portafolio completo.`,
    details: { ...finding.details, alert_type: finding.alert_type },
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
    title: `El historial de ${symbol} lleva ${ageDays} días sin actualizarse`,
    body: 'Lo que se mida con él describe el pasado, no hoy: riesgo, backtests y proyecciones de esa posición se quedaron en esa fecha.',
    details: { symbol, ageDays },
  }
}

/**
 * A holding moved far outside its own normal range.
 *
 * Judged against the asset's own recent volatility rather than a fixed
 * percentage: 4% is an ordinary day for a crypto asset and a rare one for a
 * bond fund.
 */
export function extraordinaryMoveNotification(
  userId: string,
  portfolioId: string,
  move: { symbol: string; date: string; returnPct: number; zScore: number },
): NotificationInput {
  const direction = move.returnPct >= 0 ? 'subió' : 'cayó'
  return {
    userId,
    portfolioId,
    category: 'market',
    kind: `extraordinary_move:${move.symbol}`,
    severity: Math.abs(move.zScore) >= 5 ? 'critical' : 'warning',
    title: `${move.symbol} ${direction} ${pct(Math.abs(move.returnPct))} el ${move.date}`,
    body: `Es ${Math.abs(move.zScore).toFixed(1)} veces su variación diaria habitual de los últimos meses. No dice qué pasará después; dice que ese día fue fuera de lo normal para este activo.`,
    details: move,
  }
}

export type PriceAlertCondition = 'above' | 'below' | 'pct_change_daily'

export function priceAlertNotification(
  userId: string,
  alert: { id: string; symbol: string; condition: PriceAlertCondition; target: number },
  observed: { price: number; changePct: number | null },
): NotificationInput {
  const what =
    alert.condition === 'above'
      ? `subió a ${observed.price} (tu alerta: por encima de ${alert.target})`
      : alert.condition === 'below'
        ? `bajó a ${observed.price} (tu alerta: por debajo de ${alert.target})`
        : `se movió ${pct(observed.changePct ?? 0)} en el día (tu alerta: ±${alert.target}%)`
  return {
    userId,
    category: 'market',
    kind: `price_alert:${alert.id}`,
    severity: 'info',
    title: `Alerta de ${alert.symbol}`,
    body: `${alert.symbol} ${what}. La alerta quedó desactivada para no repetirse; puedes reactivarla en Alertas.`,
    details: { alertId: alert.id, symbol: alert.symbol, condition: alert.condition, target: alert.target, ...observed },
  }
}

export type NotifiedJob = 'montecarlo' | 'backtest' | 'optimisation' | 'stress_test' | 'factors'

export function jobFinishedNotification(
  userId: string,
  portfolioId: string | null,
  job: NotifiedJob,
  succeeded: boolean,
): NotificationInput {
  const labels: Record<NotifiedJob, string> = {
    montecarlo: 'La simulación Monte Carlo',
    backtest: 'El backtest',
    optimisation: 'La optimización',
    stress_test: 'El stress test',
    factors: 'El análisis de factores',
  }
  return {
    userId,
    portfolioId,
    category: 'system',
    kind: `${job}_${succeeded ? 'done' : 'failed'}`,
    severity: succeeded ? 'info' : 'warning',
    title: succeeded ? `${labels[job]} terminó` : `${labels[job]} no pudo terminar`,
    body: succeeded
      ? 'Los resultados están listos en Análisis.'
      : 'No se guardó nada. Vuelve a intentarlo, o revisa que las posiciones tengan suficiente historial de precios.',
    details: { job, succeeded },
  }
}
