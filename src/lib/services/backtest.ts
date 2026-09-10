// Backtesting — pure functions, no I/O.
//
// A backtest is the easiest thing in finance to get wrong in a way that looks
// like success. The single biggest source of that is look-ahead: letting the
// strategy see, however indirectly, a price it could not have known yet. A
// backtest with look-ahead does not produce a slightly optimistic number, it
// produces a fictional one.
//
// Two structural choices here exist to make that hard to write by accident:
//
//   1. The strategy is INJECTED as a function that receives only the closes up
//      to and including the decision bar. It is never handed the full series,
//      so it cannot index past the present even if it tried.
//   2. A decision made on bar i EXECUTES at bar i+1. Buying at the same close
//      you just looked at is the classic version of the bug, and it flatters
//      any momentum strategy enormously.
//
// Both are asserted directly in the tests.
//
// See docs/DATA_QUALITY.md for why the price series feeding this must be
// split-adjusted first.

import { analyseDrawdowns } from './drawdown'
import { historicalVaR } from './var'
import { roundMoney } from '@/lib/utils/money'

export type Bar = { date: string; close: number }

export type SignalAction = 'buy' | 'hold' | 'sell'

/**
 * A strategy. Receives the closes up to and including the decision bar and
 * nothing else — the shape of this signature is the look-ahead guard.
 */
export type SignalFn = (closesToDate: number[]) => SignalAction

const TRADING_DAYS = 252
const DEFAULT_WARMUP = 50
const DEFAULT_CAPITAL = 10000

export type Trade = {
  entryDate: string
  entryPrice: number
  exitDate: string | null
  exitPrice: number | null
  returnPct: number | null
  days: number | null
  won: boolean | null
}

export type PerformanceSummary = {
  finalValue: number
  totalReturnPct: number
  cagrPct: number
  volatilityPct: number
  sharpe: number | null
  sortino: number | null
  maxDrawdownPct: number
  var95Pct: number | null
  trades: number
  hitRatePct: number | null
  /** Share of the tested period the strategy actually held the asset. */
  timeInMarketPct: number
}

export type BacktestResult = {
  strategy: PerformanceSummary
  buyAndHold: PerformanceSummary
  trades: Trade[]
  equityCurve: Array<{ date: string; strategy: number; buyAndHold: number }>
  warnings: string[]
}

export type BacktestOptions = {
  initialCapital?: number
  /** Bars withheld before the first decision, so the signal has history to read. */
  warmupBars?: number
  /** Round-trip cost per side, as a percentage of the traded value. */
  costPct?: number
  /** Annual risk-free rate as a fraction, for Sharpe and Sortino. */
  riskFreeRate?: number
}

function usableBars(bars: Bar[]): Bar[] {
  return [...bars]
    .filter((b) => Number.isFinite(b.close) && b.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date))
}

function dailyReturns(values: number[]): number[] {
  const out: number[] = []
  for (let i = 1; i < values.length; i++) {
    if (values[i - 1] > 0) out.push(values[i] / values[i - 1] - 1)
  }
  return out
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1)
  return Math.sqrt(variance)
}

function yearsBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`)
  const b = Date.parse(`${to}T00:00:00Z`)
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 0
  return (b - a) / (365 * 86_400_000)
}

/**
 * Summarise an equity curve.
 *
 * Sharpe and Sortino come back null rather than zero when there is no
 * dispersion to divide by: a flat curve has no risk-adjusted return, and 0 would
 * read as "mediocre" instead of "not applicable".
 */
function summarise(
  curve: Array<{ date: string; value: number }>,
  trades: Trade[],
  timeInMarketPct: number,
  initialCapital: number,
  riskFreeRate: number,
): PerformanceSummary {
  const values = curve.map((p) => p.value)
  const finalValue = roundMoney(values[values.length - 1] ?? initialCapital)
  const returns = dailyReturns(values)

  const totalReturnPct = initialCapital > 0 ? (finalValue / initialCapital - 1) * 100 : 0
  const years = curve.length >= 2 ? yearsBetween(curve[0].date, curve[curve.length - 1].date) : 0
  const cagrPct =
    years > 0 && initialCapital > 0 && finalValue > 0
      ? (Math.pow(finalValue / initialCapital, 1 / years) - 1) * 100
      : 0

  const dailyVol = stdDev(returns)
  const annualVol = dailyVol * Math.sqrt(TRADING_DAYS)
  const annualReturn =
    returns.length > 0 ? (returns.reduce((a, b) => a + b, 0) / returns.length) * TRADING_DAYS : 0

  const downside = returns.filter((r) => r < 0)
  const annualDownside = stdDev(downside) * Math.sqrt(TRADING_DAYS)

  const drawdowns = analyseDrawdowns(curve.map((p) => ({ date: p.date, value: p.value })))

  const completed = trades.filter((t) => t.won !== null)
  const wins = completed.filter((t) => t.won).length

  return {
    finalValue,
    totalReturnPct,
    cagrPct,
    volatilityPct: annualVol * 100,
    sharpe: annualVol > 1e-10 ? (annualReturn - riskFreeRate) / annualVol : null,
    sortino: annualDownside > 1e-10 ? (annualReturn - riskFreeRate) / annualDownside : null,
    maxDrawdownPct: drawdowns.maxDrawdownPct,
    var95Pct: historicalVaR(returns, 95) === null ? null : historicalVaR(returns, 95)! * 100,
    trades: completed.length,
    hitRatePct: completed.length > 0 ? (wins / completed.length) * 100 : null,
    timeInMarketPct,
  }
}

/**
 * Run a signal over a price series and compare it to simply holding the asset.
 *
 * Buy-and-hold is not decoration. A strategy that returns 40% is uninteresting
 * if the asset returned 60% while it sat in cash half the time, and the only way
 * to see that is to put the two curves side by side.
 */
export function backtestSignal(
  bars: Bar[],
  signal: SignalFn,
  options: BacktestOptions = {},
): BacktestResult | null {
  const series = usableBars(bars)
  const warmup = Math.max(1, Math.floor(options.warmupBars ?? DEFAULT_WARMUP))
  const initialCapital = options.initialCapital ?? DEFAULT_CAPITAL
  const costRate = Math.max(0, options.costPct ?? 0) / 100
  const riskFreeRate = options.riskFreeRate ?? 0

  // One bar past the warmup to decide on, and one after that to execute on.
  if (series.length < warmup + 2) return null

  const warnings: string[] = []
  if (series.length - warmup < 60) {
    warnings.push(
      `Only ${series.length - warmup} bars are tested after the warmup. Any result from a window this short is closer to an anecdote than a measurement.`,
    )
  }

  const closes = series.map((b) => b.close)

  let cash = initialCapital
  let shares = 0
  let openTrade: Trade | null = null
  const trades: Trade[] = []

  const strategyCurve: Array<{ date: string; value: number }> = []
  const holdCurve: Array<{ date: string; value: number }> = []
  const equityCurve: BacktestResult['equityCurve'] = []

  // Buy and hold enters at the same bar the strategy first could have.
  const holdEntryPrice = series[warmup + 1].close
  const holdShares = initialCapital / holdEntryPrice

  let barsInMarket = 0
  let barsTested = 0

  // i is the DECISION bar; execution happens at i + 1.
  for (let i = warmup; i < series.length - 1; i++) {
    const action = signal(closes.slice(0, i + 1))
    const executionBar = series[i + 1]
    const price = executionBar.close

    if (action === 'buy' && shares === 0) {
      const cost = cash * costRate
      shares = (cash - cost) / price
      cash = 0
      openTrade = {
        entryDate: executionBar.date,
        entryPrice: price,
        exitDate: null,
        exitPrice: null,
        returnPct: null,
        days: null,
        won: null,
      }
    } else if (action === 'sell' && shares > 0 && openTrade) {
      const gross = shares * price
      cash = gross - gross * costRate
      shares = 0
      openTrade.exitDate = executionBar.date
      openTrade.exitPrice = price
      openTrade.returnPct = (price / openTrade.entryPrice - 1) * 100
      openTrade.days = Math.round(
        (Date.parse(`${executionBar.date}T00:00:00Z`) -
          Date.parse(`${openTrade.entryDate}T00:00:00Z`)) /
          86_400_000,
      )
      openTrade.won = openTrade.returnPct > 0
      trades.push(openTrade)
      openTrade = null
    }

    barsTested++
    if (shares > 0) barsInMarket++

    const strategyValue = cash + shares * price
    const holdValue = holdShares * price
    strategyCurve.push({ date: executionBar.date, value: strategyValue })
    holdCurve.push({ date: executionBar.date, value: holdValue })
    equityCurve.push({
      date: executionBar.date,
      strategy: roundMoney(strategyValue),
      buyAndHold: roundMoney(holdValue),
    })
  }

  // A position still open at the end is closed at the last price. Leaving it
  // open would report an unrealised gain as if it had been banked.
  if (openTrade && shares > 0) {
    const last = series[series.length - 1]
    const gross = shares * last.close
    cash = gross - gross * costRate
    shares = 0
    openTrade.exitDate = last.date
    openTrade.exitPrice = last.close
    openTrade.returnPct = (last.close / openTrade.entryPrice - 1) * 100
    openTrade.days = Math.round(
      (Date.parse(`${last.date}T00:00:00Z`) - Date.parse(`${openTrade.entryDate}T00:00:00Z`)) /
        86_400_000,
    )
    openTrade.won = openTrade.returnPct > 0
    trades.push(openTrade)
    openTrade = null

    if (strategyCurve.length > 0) strategyCurve[strategyCurve.length - 1].value = cash
    if (equityCurve.length > 0) equityCurve[equityCurve.length - 1].strategy = roundMoney(cash)
  }

  const timeInMarketPct = barsTested > 0 ? (barsInMarket / barsTested) * 100 : 0

  return {
    strategy: summarise(strategyCurve, trades, timeInMarketPct, initialCapital, riskFreeRate),
    buyAndHold: summarise(holdCurve, [], 100, initialCapital, riskFreeRate),
    trades,
    equityCurve,
    warnings,
  }
}

// ─── Portfolio backtesting (P1-17) ──────────────────────────────────────────

export type RebalanceFrequency = 'none' | 'monthly' | 'quarterly' | 'semiannual' | 'annual'

export type PortfolioBacktestOptions = {
  rebalance: RebalanceFrequency
  initialCapital?: number
  /** Cost per unit of value traded during a rebalance, as a percentage. */
  costPct?: number
  riskFreeRate?: number
}

export type PortfolioBacktestResult = {
  finalValue: number
  totalReturnPct: number
  cagrPct: number
  volatilityPct: number
  sharpe: number | null
  sortino: number | null
  maxDrawdownPct: number
  var95Pct: number | null
  rebalanceCount: number
  totalCosts: number
  /** Weights at the end, which is where the drift shows. */
  finalWeights: Record<string, number>
  equityCurve: Array<{ date: string; value: number }>
  rebalance: RebalanceFrequency
}

const REBALANCE_DAYS: Record<Exclude<RebalanceFrequency, 'none'>, number> = {
  monthly: 30,
  quarterly: 91,
  semiannual: 182,
  annual: 365,
}

/**
 * Hold a set of weights through history under a rebalancing schedule.
 *
 * Only dates every holding has a price for are used. Carrying a stale price
 * forward for one asset while the others move would invent a return the book
 * never earned, and it is the reason a naive multi-asset backtest quietly drifts
 * away from reality.
 */
export function backtestPortfolio(
  seriesBySymbol: Record<string, Bar[]>,
  targetWeights: Record<string, number>,
  options: PortfolioBacktestOptions,
): PortfolioBacktestResult | null {
  const symbols = Object.keys(targetWeights)
  if (symbols.length === 0) return null

  const weightSum = symbols.reduce((s, k) => s + (targetWeights[k] ?? 0), 0)
  if (!Number.isFinite(weightSum) || Math.abs(weightSum - 1) > 1e-3) return null
  if (symbols.some((s) => (targetWeights[s] ?? 0) < 0)) return null

  const priceMaps = new Map<string, Map<string, number>>()
  for (const symbol of symbols) {
    const bars = usableBars(seriesBySymbol[symbol] ?? [])
    if (bars.length === 0) return null
    priceMaps.set(symbol, new Map(bars.map((b) => [b.date, b.close])))
  }

  const firstSymbol = symbols[0]
  const commonDates = [...priceMaps.get(firstSymbol)!.keys()]
    .filter((date) => symbols.every((s) => priceMaps.get(s)!.has(date)))
    .sort()

  if (commonDates.length < 2) return null

  const initialCapital = options.initialCapital ?? DEFAULT_CAPITAL
  const costRate = Math.max(0, options.costPct ?? 0) / 100
  const riskFreeRate = options.riskFreeRate ?? 0

  const priceAt = (symbol: string, date: string) => priceMaps.get(symbol)!.get(date)!

  // Open the book at target weights on day one.
  const units: Record<string, number> = {}
  for (const symbol of symbols) {
    units[symbol] = (initialCapital * targetWeights[symbol]) / priceAt(symbol, commonDates[0])
  }

  let rebalanceCount = 0
  let totalCosts = 0
  let lastRebalance = commonDates[0]
  const curve: Array<{ date: string; value: number }> = []

  for (const date of commonDates) {
    let value = 0
    for (const symbol of symbols) value += units[symbol] * priceAt(symbol, date)

    if (options.rebalance !== 'none' && date !== commonDates[0]) {
      const elapsed =
        (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${lastRebalance}T00:00:00Z`)) / 86_400_000
      if (elapsed >= REBALANCE_DAYS[options.rebalance]) {
        // Cost is charged on the value that actually moves, which is half the
        // sum of the absolute deviations: every peso sold is a peso bought.
        let traded = 0
        for (const symbol of symbols) {
          const current = units[symbol] * priceAt(symbol, date)
          traded += Math.abs(current - value * targetWeights[symbol])
        }
        const cost = (traded / 2) * costRate
        totalCosts += cost
        value -= cost

        for (const symbol of symbols) {
          units[symbol] = (value * targetWeights[symbol]) / priceAt(symbol, date)
        }
        rebalanceCount++
        lastRebalance = date
      }
    }

    curve.push({ date, value })
  }

  const lastDate = commonDates[commonDates.length - 1]
  const finalValue = curve[curve.length - 1].value
  const finalWeights: Record<string, number> = {}
  for (const symbol of symbols) {
    finalWeights[symbol] = finalValue > 0 ? (units[symbol] * priceAt(symbol, lastDate)) / finalValue : 0
  }

  const summary = summarise(curve, [], 100, initialCapital, riskFreeRate)

  return {
    finalValue: summary.finalValue,
    totalReturnPct: summary.totalReturnPct,
    cagrPct: summary.cagrPct,
    volatilityPct: summary.volatilityPct,
    sharpe: summary.sharpe,
    sortino: summary.sortino,
    maxDrawdownPct: summary.maxDrawdownPct,
    var95Pct: summary.var95Pct,
    rebalanceCount,
    totalCosts: roundMoney(totalCosts),
    finalWeights,
    equityCurve: curve.map((p) => ({ date: p.date, value: roundMoney(p.value) })),
    rebalance: options.rebalance,
  }
}

// ─── Walk-forward (P1-18) ───────────────────────────────────────────────────

/**
 * Builds a strategy from a training slice. A strategy with no fitted parameters
 * simply ignores the argument — the machinery is still what makes the result
 * out-of-sample, and it is what any future parameterised strategy will need.
 */
export type FitFn = (trainBars: Bar[]) => SignalFn

export type WalkForwardWindow = {
  index: number
  trainFrom: string
  trainTo: string
  testFrom: string
  testTo: string
  result: BacktestResult
}

export type WalkForwardResult = {
  config: { trainBars: number; testBars: number; warmupBars: number }
  windows: WalkForwardWindow[]
  aggregate: {
    windows: number
    /** Compounded across every out-of-sample window. */
    totalReturnPct: number
    buyAndHoldReturnPct: number
    winningWindows: number
    averageWindowReturnPct: number
  }
}

export type WalkForwardOptions = BacktestOptions & {
  trainBars: number
  testBars: number
}

/**
 * Train, test out-of-sample, roll forward, repeat.
 *
 * The point is not the backtest, it is the honesty of it. A strategy tuned on
 * the same history it is measured on will always look good; walk-forward is what
 * separates "this worked" from "this was fitted to what already happened".
 *
 * Each window trains on `trainBars` and is measured only on the `testBars` that
 * follow, and the window then rolls forward by the test length so no bar is ever
 * both trained on and tested on.
 */
export function walkForward(
  bars: Bar[],
  fit: FitFn,
  options: WalkForwardOptions,
): WalkForwardResult | null {
  const series = usableBars(bars)
  const trainBars = Math.max(2, Math.floor(options.trainBars))
  const testBars = Math.max(2, Math.floor(options.testBars))
  // The test slice carries its own warmup so the signal has history at its start.
  const warmupBars = Math.max(1, Math.floor(options.warmupBars ?? Math.min(20, trainBars - 1)))

  if (series.length < trainBars + testBars) return null

  const windows: WalkForwardWindow[] = []
  let index = 0

  for (let start = 0; start + trainBars + testBars <= series.length; start += testBars) {
    const train = series.slice(start, start + trainBars)
    // The test slice is prefixed with the tail of the training window so the
    // signal has enough history to produce anything on its first test bar. Those
    // prefix bars are warmup only — no trade is opened on them.
    const testStart = start + trainBars
    const prefixed = series.slice(Math.max(0, testStart - warmupBars), testStart + testBars)

    const strategy = fit(train)
    const result = backtestSignal(prefixed, strategy, { ...options, warmupBars })
    if (!result) continue

    windows.push({
      index: index++,
      trainFrom: train[0].date,
      trainTo: train[train.length - 1].date,
      testFrom: series[testStart].date,
      testTo: series[Math.min(series.length - 1, testStart + testBars - 1)].date,
      result,
    })
  }

  if (windows.length === 0) return null

  let compounded = 1
  let compoundedHold = 1
  let winning = 0
  for (const w of windows) {
    compounded *= 1 + w.result.strategy.totalReturnPct / 100
    compoundedHold *= 1 + w.result.buyAndHold.totalReturnPct / 100
    if (w.result.strategy.totalReturnPct > 0) winning++
  }

  const averageWindowReturnPct =
    windows.reduce((s, w) => s + w.result.strategy.totalReturnPct, 0) / windows.length

  return {
    config: { trainBars, testBars, warmupBars },
    windows,
    aggregate: {
      windows: windows.length,
      totalReturnPct: (compounded - 1) * 100,
      buyAndHoldReturnPct: (compoundedHold - 1) * 100,
      winningWindows: winning,
      averageWindowReturnPct,
    },
  }
}
