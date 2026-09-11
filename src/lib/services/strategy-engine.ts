// Running a built strategy — pure functions, no I/O.
//
// Thin on purpose. strategy-rule.ts turns a strategy into a SignalFn and
// backtest.ts runs SignalFns; this is the seam between them, and it exists for
// three things neither side should own:
//
//   The warmup. A strategy using a 200-day average cannot decide anything on
//   bar 10, and the caller should not have to know that. The strategy already
//   declares its longest period during validation, so the warmup comes from the
//   strategy itself rather than from a constant someone has to remember.
//
//   The comparison. Every result travels with buy-and-hold beside it, because a
//   strategy return quoted alone is unreadable — 40% sounds good until the thing
//   it traded went up 60% while you were out of it.
//
//   The warnings. A strategy with no sell rule is buy-and-hold in costume, and a
//   condition comparing something to itself never fires. Both produce equity
//   curves that look like deliberate caution rather than a mistake, so the
//   validation warnings ride along to the interface instead of being dropped.

import {
  backtestSignal,
  type Bar,
  type BacktestResult,
  type BacktestOptions,
} from './backtest'
import { compileStrategy, validateStrategy, describeRule, type Strategy } from './strategy-rule'

/** Bars held back beyond the longest indicator, so it has settled before deciding. */
const WARMUP_MARGIN = 10
/** Even a strategy with no indicators needs some history behind it. */
const MIN_WARMUP = 20

export type StrategyRun = {
  name: string
  /** What the rules say, in words, so a result can be checked against intent. */
  buyRule: string
  sellRule: string
  warmupBars: number
  backtest: BacktestResult
  beatBuyAndHold: boolean
  /** Strategy return minus buy-and-hold return, in percentage points. */
  versusBuyAndHoldPp: number
  warnings: string[]
}

/**
 * Run one built strategy over one price series.
 *
 * Null when the strategy does not validate, or when the history is too short for
 * the warmup the strategy itself requires — a 50-day average tested on 30 bars
 * is not a short test, it is no test.
 */
export function runStrategy(
  strategy: Strategy,
  bars: Bar[],
  options: BacktestOptions = {},
): StrategyRun | null {
  const validation = validateStrategy(strategy)
  if (!validation.valid) return null

  const signal = compileStrategy(strategy)
  if (!signal) return null

  // The strategy's own requirement, unless the caller imposes a longer shared
  // one — which compareStrategies does, so every row is measured over the same
  // window. Never SHORTER than the strategy needs: that would decide on an
  // indicator that has not filled.
  const warmupBars = Math.max(
    MIN_WARMUP,
    validation.longestPeriod + WARMUP_MARGIN,
    options.warmupBars ?? 0,
  )

  const backtest = backtestSignal(bars, signal, { ...options, warmupBars })
  if (!backtest) return null

  const versusBuyAndHoldPp =
    backtest.strategy.totalReturnPct - backtest.buyAndHold.totalReturnPct

  return {
    name: strategy.name,
    buyRule: describeRule(strategy.buy),
    sellRule: describeRule(strategy.sell),
    warmupBars,
    backtest,
    beatBuyAndHold: versusBuyAndHoldPp > 0,
    versusBuyAndHoldPp,
    // The backtester's own warnings (too few bars, etc.) plus the strategy's.
    warnings: [...validation.warnings, ...backtest.warnings],
  }
}

export type StrategyComparison = {
  results: StrategyRun[]
  /** The window every row was measured over, in bars withheld at the start. */
  sharedWarmupBars: number
  /** Strategies that could not run, and why. */
  skipped: Array<{ name: string; reason: string }>
  /** The same for every strategy: one asset, one benchmark. */
  buyAndHoldReturnPct: number
  beatCount: number
  summary: string
}

/**
 * Several strategies over the SAME bars.
 *
 * One series for all of them, so buy-and-hold is a single number rather than one
 * per row. Comparing strategies backtested over different windows compares two
 * markets and calls it a comparison of methods.
 *
 * That is not automatic, and the first version got it wrong. Each strategy sets
 * its own warmup from its longest indicator, so a 50-day cross started 60 bars
 * in while an RSI rule started at 24 — and buy-and-hold came out -17.3% for one
 * and -4.1% for the other on the SAME asset. The comparison was between two
 * different windows wearing one table.
 *
 * So the warmup is the MAXIMUM any of them needs, applied to all. The shorter
 * strategies give up some history; in exchange every number in the table, the
 * benchmark included, describes the same stretch of market.
 *
 * With one caveat that the first version got wrong too: strategies that cannot
 * run on this history are excluded BEFORE that maximum is taken. Otherwise a
 * single demanding rule poisons the whole table — the momentum example needs a
 * 200-day average, and against six months of daily bars it dragged the shared
 * warmup past the end of the data and nothing at all could run.
 *
 * A strategy that cannot run is skipped and named, not fatal: one impossible
 * rule should not blank the table for the rest.
 */
export function compareStrategies(
  strategies: Strategy[],
  bars: Bar[],
  options: BacktestOptions = {},
): StrategyComparison | null {
  if (strategies.length === 0) return null

  const results: StrategyRun[] = []
  const skipped: Array<{ name: string; reason: string }> = []

  const usable = bars.filter((b) => Number.isFinite(b.close) && b.close > 0).length

  // Sort the impossible from the runnable FIRST, so the shared warmup below is
  // taken only over strategies this history can actually support.
  const runnable: Array<{ strategy: Strategy; warmup: number }> = []

  for (const strategy of strategies) {
    const validation = validateStrategy(strategy)
    if (!validation.valid) {
      skipped.push({
        name: strategy.name || '(sin nombre)',
        reason: validation.errors.join(' '),
      })
      continue
    }

    const warmup = Math.max(MIN_WARMUP, validation.longestPeriod + WARMUP_MARGIN)
    // Two bars past the warmup: one to decide on, one to execute on.
    if (usable < warmup + 2) {
      skipped.push({
        name: strategy.name,
        reason: `Necesita ${warmup} barras de calentamiento y solo hay ${usable} en total. Su indicador mas largo es de ${validation.longestPeriod} periodos.`,
      })
      continue
    }

    runnable.push({ strategy, warmup })
  }

  if (runnable.length === 0) return null

  // One warmup for every surviving row: the longest any of them needs.
  const sharedWarmup = runnable.reduce((longest, r) => Math.max(longest, r.warmup), MIN_WARMUP)

  for (const { strategy } of runnable) {
    const run = runStrategy(strategy, bars, { ...options, warmupBars: sharedWarmup })
    if (!run) {
      skipped.push({
        name: strategy.name,
        reason: `El historial no alcanza para la ventana compartida de ${sharedWarmup} barras que impone la estrategia mas exigente de la comparacion.`,
      })
      continue
    }
    results.push(run)
  }

  if (results.length === 0) return null

  // Safe to take from the first row now that every row shares a window.
  const buyAndHoldReturnPct = results[0].backtest.buyAndHold.totalReturnPct
  const beatCount = results.filter((r) => r.beatBuyAndHold).length

  const best = results.reduce((winner, run) =>
    run.versusBuyAndHoldPp > winner.versusBuyAndHoldPp ? run : winner,
  )

  const summary =
    beatCount === 0
      ? `Ninguna de las ${results.length} estrategias supero a comprar y mantener, que rindio ${buyAndHoldReturnPct.toFixed(1)}% en este periodo. La menos mala fue "${best.name}", ${Math.abs(best.versusBuyAndHoldPp).toFixed(1)} puntos por debajo. Esto es lo normal y no significa que el backtest este mal: operar cuesta dinero y estar fuera del mercado cuesta las subidas.`
      : `${beatCount} de ${results.length} estrategias superaron a comprar y mantener (${buyAndHoldReturnPct.toFixed(1)}%). La mejor fue "${best.name}", ${best.versusBuyAndHoldPp.toFixed(1)} puntos por encima. Ojo: haber ganado en ESTE periodo no dice que vaya a repetirse, y cuantas mas reglas pruebes, mas facil es que alguna gane por casualidad.`

  return {
    results,
    skipped,
    sharedWarmupBars: sharedWarmup,
    buyAndHoldReturnPct,
    beatCount,
    summary,
  }
}
