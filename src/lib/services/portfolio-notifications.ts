// What the nightly job tells each user about their portfolios (4.5).
//
// The notification table, its builders and its API existed with zero rows,
// because nothing produced events. This is the producer, and it runs inside
// the nightly cron that already walks every portfolio — not a scheduler of its
// own.
//
// Pure evaluators first, so every threshold is testable without a database;
// the I/O that feeds them is at the bottom.

import type { SupabaseClient } from '@supabase/supabase-js'
import { analyseDrawdowns, type ValuePoint } from './drawdown'
import { evaluateConcentration, saveAlerts, type ConcentrationAlert } from './concentration'
import { fetchAdjustedPriceHistory, type PriceRow } from './price-history'
import { historicalConversion } from './fx-history'
import { valueBookInBase } from './book-valuation'
import { getBatchQuotes } from './market'
import type { Conversion } from './fx'
import { TRADING_DAYS_PER_YEAR } from '@/lib/constants/financial-constants'
import {
  concentrationNotification,
  deliverNotifications,
  drawdownNotification,
  extraordinaryMoveNotification,
  priceAlertNotification,
  staleDataNotification,
  type DeliveryResult,
  type NotificationInput,
  type PriceAlertCondition,
} from './notifications'

type Bar = { date: string; close: number }

const DAY_MS = 86_400_000

/** Sessions of history the drawdown looks back over: a trading year. */
export const DRAWDOWN_LOOKBACK_SESSIONS = TRADING_DAYS_PER_YEAR

/**
 * The book as it stands today, valued back through its common history.
 *
 * The "current weights" drawdown of 3.2: today's units at each day's close,
 * converted at each day's rate. Contributions and withdrawals cannot move it,
 * so a sale is never reported as a fall. Only dates every covered holding has
 * a close for are used; a holding with no history at all is left out rather
 * than valued at zero, which would draw a fall that never happened.
 */
export function repricedValueSeries(
  closes: Record<string, Bar[]>,
  units: Record<string, number>,
  factor: Conversion['factor'],
  lookback = DRAWDOWN_LOOKBACK_SESSIONS,
): ValuePoint[] {
  const held = Object.keys(units).filter((s) => units[s] > 0 && (closes[s]?.length ?? 0) > 0)
  if (held.length === 0) return []

  const byDate = held.map((symbol) => new Map(closes[symbol].map((bar) => [bar.date, bar.close])))
  const dates = [...byDate[0].keys()].filter((date) => byDate.every((m) => Number.isFinite(m.get(date))))
  dates.sort()

  return dates.slice(-lookback).map((date) => ({
    date,
    value: held.reduce((sum, symbol, i) => sum + units[symbol] * byDate[i].get(date)! * factor(symbol, date), 0),
  }))
}

/** Returns needed before a holding's "normal" range means anything. */
const MIN_RETURNS_FOR_MOVE = 20

export type ExtraordinaryMove = { symbol: string; date: string; returnPct: number; zScore: number }

/**
 * The latest session's move, when it is far outside the holding's own range.
 *
 * Measured against the holding's previous `lookback` daily returns, so the bar
 * is its own volatility and not one percentage for every asset. Both limits
 * must be cleared: a 3-sigma day on a bond fund that moved 0.4% is not news. A
 * move older than `maxAgeDays` is history, not an event, and is not reported.
 */
export function extraordinaryMove(
  symbol: string,
  bars: Bar[],
  asOf: Date,
  options: { lookback?: number; minZ?: number; minAbsPct?: number; maxAgeDays?: number } = {},
): ExtraordinaryMove | null {
  const lookback = options.lookback ?? 60
  const minZ = options.minZ ?? 3
  const minAbsPct = options.minAbsPct ?? 3
  const maxAgeDays = options.maxAgeDays ?? 4

  const sorted = [...bars].filter((b) => Number.isFinite(b.close) && b.close > 0).sort((a, b) => a.date.localeCompare(b.date))
  if (sorted.length < MIN_RETURNS_FOR_MOVE + 2) return null

  const last = sorted[sorted.length - 1]
  if ((asOf.getTime() - Date.parse(`${last.date}T00:00:00Z`)) / DAY_MS > maxAgeDays) return null

  const returns = sorted.slice(1).map((bar, i) => bar.close / sorted[i].close - 1)
  const latest = returns[returns.length - 1]
  const prior = returns.slice(0, -1).slice(-lookback)
  if (prior.length < MIN_RETURNS_FOR_MOVE) return null

  const mean = prior.reduce((s, r) => s + r, 0) / prior.length
  const variance = prior.reduce((s, r) => s + (r - mean) ** 2, 0) / (prior.length - 1)
  const sd = Math.sqrt(variance)
  if (!(sd > 0)) return null

  const zScore = (latest - mean) / sd
  const returnPct = latest * 100
  if (Math.abs(zScore) < minZ || Math.abs(returnPct) < minAbsPct) return null
  return { symbol, date: last.date, returnPct, zScore }
}

/** Calendar days since a holding's last stored close before it counts as stopped. */
export const STALE_HISTORY_DAYS = 7

/** Whole days between a close's date and `asOf`. */
export function historyAgeDays(lastDate: string, asOf: Date): number {
  return Math.floor((asOf.getTime() - Date.parse(`${lastDate}T00:00:00Z`)) / DAY_MS)
}

export type PortfolioEvaluationInput = {
  userId: string
  portfolioId: string
  portfolioName: string
  closes: Record<string, Bar[]>
  units: Record<string, number>
  factor: Conversion['factor']
  concentration: ConcentrationAlert[]
  asOf: Date
}

/** Everything one portfolio has to say tonight. Pure. */
export function evaluatePortfolio(input: PortfolioEvaluationInput): NotificationInput[] {
  const out: NotificationInput[] = []

  const series = repricedValueSeries(input.closes, input.units, input.factor)
  if (series.length >= 2) {
    const drawdown = analyseDrawdowns(series)
    const notification = drawdownNotification(
      input.userId,
      input.portfolioId,
      drawdown.currentDrawdownPct,
      drawdown.currentDrawdownPct > 0 ? drawdown.recoveryRequiredPct : null,
      input.portfolioName,
    )
    if (notification) out.push(notification)
  }

  for (const finding of input.concentration) {
    out.push(concentrationNotification(input.userId, input.portfolioId, finding, input.portfolioName))
  }

  for (const symbol of Object.keys(input.units)) {
    const bars = input.closes[symbol]
    if (!bars || bars.length === 0) continue
    const move = extraordinaryMove(symbol, bars, input.asOf)
    if (move) out.push(extraordinaryMoveNotification(input.userId, input.portfolioId, move))

    const last = bars.reduce((latest, bar) => (bar.date > latest ? bar.date : latest), bars[0].date)
    const age = historyAgeDays(last, input.asOf)
    if (age > STALE_HISTORY_DAYS) out.push(staleDataNotification(input.userId, symbol, age))
  }

  return out
}

export type PriceAlertRow = {
  id: string
  user_id: string
  symbol: string
  condition: PriceAlertCondition
  target_value: number
}

/** Whether an active price alert's condition holds for a quote. Pure. */
export function priceAlertFires(alert: PriceAlertRow, quote: { price: number | null; changePct: number | null } | undefined): boolean {
  if (!quote) return false
  const target = Number(alert.target_value)
  if (!Number.isFinite(target)) return false
  if (alert.condition === 'pct_change_daily') {
    return quote.changePct !== null && Number.isFinite(quote.changePct) && Math.abs(quote.changePct) >= Math.abs(target)
  }
  if (quote.price === null || !Number.isFinite(quote.price) || quote.price <= 0) return false
  return alert.condition === 'above' ? quote.price >= target : quote.price <= target
}

// ─── I/O ─────────────────────────────────────────────────────────────────────

export type NotificationRunResult = DeliveryResult & {
  portfolios: number
  priceAlertsFired: number
  errors: number
}

/**
 * Evaluate every live portfolio and every active price alert, and deliver what
 * they have to say. Runs with the service role inside the nightly cron.
 *
 * Each portfolio is evaluated in its own try: one book whose history cannot be
 * read must not silence everyone else's inbox.
 */
export async function runNightlyNotifications(admin: SupabaseClient, asOf: Date = new Date()): Promise<NotificationRunResult> {
  const inputs: NotificationInput[] = []
  let errors = 0

  const { data: portfolios } = await admin
    .from('portfolios')
    .select('id, user_id, name, base_currency')
    .is('deleted_at', null)

  for (const portfolio of portfolios ?? []) {
    try {
      inputs.push(...(await evaluateStoredPortfolio(admin, portfolio, asOf)))
    } catch (err) {
      errors++
      console.error(`[notifications] portfolio ${portfolio.id} failed:`, err instanceof Error ? err.message : err)
    }
  }

  let priceAlertsFired = 0
  try {
    const fired = await evaluatePriceAlerts(admin)
    priceAlertsFired = fired.length
    inputs.push(...fired)
  } catch (err) {
    errors++
    console.error('[notifications] price alerts failed:', err instanceof Error ? err.message : err)
  }

  const delivery = await deliverNotifications(inputs, { writer: admin, now: asOf })
  return { ...delivery, portfolios: portfolios?.length ?? 0, priceAlertsFired, errors }
}

/**
 * Only the price alerts, every five minutes (/api/cron/alerts, which the
 * Cloudflare worker calls). The nightly run still evaluates them too; an
 * alert is deactivated when it fires, with a conditional update, so two runs
 * that overlap announce it once.
 *
 * They used to be evaluated only at night: an alert on a price touched at
 * 11:05 was acted on after the close, if the price was still past the line.
 */
export async function runPriceAlerts(admin: SupabaseClient, asOf: Date = new Date()): Promise<DeliveryResult & { fired: number }> {
  const fired = await evaluatePriceAlerts(admin)
  const delivery = await deliverNotifications(fired, { writer: admin, now: asOf })
  return { ...delivery, fired: fired.length }
}

async function evaluateStoredPortfolio(
  admin: SupabaseClient,
  portfolio: { id: string; user_id: string; name: string; base_currency: string | null },
  asOf: Date,
): Promise<NotificationInput[]> {
  const { data: positions } = await admin
    .from('positions')
    .select('symbol, asset_type, quantity, avg_cost, currency')
    .eq('portfolio_id', portfolio.id)
    .gt('quantity', 0)

  if (!positions || positions.length === 0) {
    await saveAlerts(admin, portfolio.id, [])
    return []
  }

  const symbols = positions.map((p) => p.symbol as string)
  const base = portfolio.base_currency ?? 'USD'
  const { rows } = await fetchAdjustedPriceHistory(admin, symbols, { limit: symbols.length * (DRAWDOWN_LOOKBACK_SESSIONS + 30) })

  const closes: Record<string, Bar[]> = {}
  for (const row of rows as PriceRow[]) (closes[row.symbol] ??= []).push({ date: row.date, close: row.close })

  const from = new Date(asOf.getTime() - 400 * DAY_MS).toISOString().slice(0, 10)
  const conversion = await historicalConversion(admin, symbols, base, from)
  const units = Object.fromEntries(positions.map((p) => [p.symbol as string, Number(p.quantity)]))

  // Concentration on today's values in one currency — the latest close per
  // holding, or its cost when it has none (book-valuation.ts).
  const lastClose: Record<string, number> = {}
  for (const [symbol, bars] of Object.entries(closes)) lastClose[symbol] = bars[bars.length - 1].close
  const valuation = await valueBookInBase(admin, positions, lastClose, base, asOf)
  const { data: companies } = await admin.from('company_data').select('symbol, sector').in('symbol', symbols)
  const sectors = Object.fromEntries((companies ?? []).map((c) => [c.symbol as string, (c.sector as string) ?? 'Unknown']))
  const concentration = evaluateConcentration(
    positions.map((p, i) => ({ symbol: p.symbol as string, asset_type: p.asset_type as string, value: valuation.values[i] })),
    valuation.total,
    portfolio.id,
    sectors,
  )
  // The portfolio page's own concentration card reads this table, and nothing
  // had ever written to it.
  await saveAlerts(admin, portfolio.id, concentration)

  return evaluatePortfolio({
    userId: portfolio.user_id,
    portfolioId: portfolio.id,
    portfolioName: portfolio.name,
    closes,
    units,
    factor: conversion.factor,
    concentration,
    asOf,
  })
}

/**
 * Active price alerts whose condition holds now. Each one that fires is
 * deactivated and stamped, so it is announced once rather than every night
 * the price stays past the line.
 */
async function evaluatePriceAlerts(admin: SupabaseClient): Promise<NotificationInput[]> {
  const { data: alerts } = await admin
    .from('alerts')
    .select('id, user_id, symbol, condition, target_value')
    .eq('is_active', true)
  if (!alerts || alerts.length === 0) return []

  const symbols = [...new Set(alerts.map((a) => a.symbol as string))]
  const quotes = await getBatchQuotes(symbols)
  const out: NotificationInput[] = []

  for (const alert of alerts as PriceAlertRow[]) {
    const quote = quotes[alert.symbol] ?? quotes[alert.symbol.toUpperCase()]
    const observed = quote ? { price: quote.price, changePct: quote.changePct } : undefined
    if (!priceAlertFires(alert, observed)) continue

    const { data: stamped } = await admin
      .from('alerts')
      .update({ is_active: false, triggered_at: new Date().toISOString() })
      .eq('id', alert.id)
      .eq('is_active', true)
      .select('id')
    if (!stamped || stamped.length === 0) continue

    out.push(
      priceAlertNotification(
        alert.user_id,
        { id: alert.id, symbol: alert.symbol, condition: alert.condition, target: Number(alert.target_value) },
        { price: Math.round(Number(quote!.price) * 100) / 100, changePct: quote!.changePct === null ? null : Math.round(quote!.changePct * 100) / 100 },
      ),
    )
  }
  return out
}
