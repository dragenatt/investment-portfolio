// Technical buy/hold/sell signal — a transparent, rule-based score built from the
// pure indicators in @/lib/utils/indicators. No external ratings needed: it works
// for any asset from its price history alone. Every rule contributes to a score in
// [-100, 100] and appends a human-readable reason, so the suggestion is explainable.

import { calculateRSI, calculateSMA, calculateBollingerBands } from '@/lib/utils/indicators'

export type SignalAction = 'buy' | 'hold' | 'sell'
export type SignalReason = { label: string; sentiment: 'bullish' | 'bearish' | 'neutral' }

export type TechnicalSignal = {
  action: SignalAction
  score: number // -100 (strong sell) .. +100 (strong buy)
  confidence: number // 0..100, strength of the signal
  reasons: SignalReason[]
  metrics: {
    price: number | null
    rsi: number | null
    sma20: number | null
    sma50: number | null
    sma200: number | null
  }
}

function lastNonNull(arr: (number | null)[]): number | null {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i] != null) return arr[i]
  }
  return null
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))

/**
 * Compute a buy/hold/sell signal from a series of closing prices (oldest → newest).
 * Rules used: RSI(14) over/undersold, price vs trend MA, SMA20↔SMA50 momentum,
 * long-term SMA200 trend, and Bollinger-band extremes. Degrades gracefully: rules
 * that need more history than is available are simply skipped.
 */
export function computeTechnicalSignal(closes: number[]): TechnicalSignal {
  const reasons: SignalReason[] = []
  const clean = closes.filter((c) => typeof c === 'number' && Number.isFinite(c))
  const price = clean.length > 0 ? clean[clean.length - 1] : null

  const empty: TechnicalSignal['metrics'] = { price, rsi: null, sma20: null, sma50: null, sma200: null }
  if (price == null || clean.length < 20) {
    return {
      action: 'hold',
      score: 0,
      confidence: 0,
      reasons: [{ label: 'Datos insuficientes para una señal fiable', sentiment: 'neutral' }],
      metrics: empty,
    }
  }

  const rsi = lastNonNull(calculateRSI(clean, 14))
  const sma20 = lastNonNull(calculateSMA(clean, 20))
  const sma50 = clean.length >= 50 ? lastNonNull(calculateSMA(clean, 50)) : null
  const sma200 = clean.length >= 200 ? lastNonNull(calculateSMA(clean, 200)) : null
  const bb = calculateBollingerBands(clean, 20, 2)
  const bbUpper = lastNonNull(bb.upper)
  const bbLower = lastNonNull(bb.lower)

  let score = 0

  // 1. RSI — mean reversion
  if (rsi != null) {
    if (rsi < 30) { score += 30; reasons.push({ label: `RSI ${rsi.toFixed(0)} — sobreventa`, sentiment: 'bullish' }) }
    else if (rsi > 70) { score -= 30; reasons.push({ label: `RSI ${rsi.toFixed(0)} — sobrecompra`, sentiment: 'bearish' }) }
    else reasons.push({ label: `RSI ${rsi.toFixed(0)} — neutral`, sentiment: 'neutral' })
  }

  // 2. Price vs trend MA (SMA50 preferred, SMA20 fallback)
  const trendMa = sma50 ?? sma20
  const trendMaLabel = sma50 ? 'SMA50' : 'SMA20'
  if (trendMa != null) {
    if (price > trendMa) { score += 20; reasons.push({ label: `Precio sobre ${trendMaLabel} — tendencia alcista`, sentiment: 'bullish' }) }
    else { score -= 20; reasons.push({ label: `Precio bajo ${trendMaLabel} — tendencia bajista`, sentiment: 'bearish' }) }
  }

  // 3. Short vs long MA momentum
  if (sma20 != null && sma50 != null) {
    if (sma20 > sma50) { score += 20; reasons.push({ label: 'SMA20 sobre SMA50 — momentum positivo', sentiment: 'bullish' }) }
    else { score -= 20; reasons.push({ label: 'SMA20 bajo SMA50 — momentum negativo', sentiment: 'bearish' }) }
  }

  // 4. Long-term trend
  if (sma200 != null) {
    if (price > sma200) { score += 15; reasons.push({ label: 'Precio sobre SMA200 — alcista a largo plazo', sentiment: 'bullish' }) }
    else { score -= 15; reasons.push({ label: 'Precio bajo SMA200 — bajista a largo plazo', sentiment: 'bearish' }) }
  }

  // 5. Bollinger extremes
  if (bbUpper != null && bbLower != null) {
    if (price <= bbLower) { score += 15; reasons.push({ label: 'Precio en la banda inferior de Bollinger', sentiment: 'bullish' }) }
    else if (price >= bbUpper) { score -= 15; reasons.push({ label: 'Precio en la banda superior de Bollinger', sentiment: 'bearish' }) }
  }

  score = clamp(score, -100, 100)
  const action: SignalAction = score >= 25 ? 'buy' : score <= -25 ? 'sell' : 'hold'

  return {
    action,
    score,
    confidence: clamp(Math.abs(score), 0, 100),
    reasons,
    metrics: { price, rsi, sma20, sma50, sma200 },
  }
}
