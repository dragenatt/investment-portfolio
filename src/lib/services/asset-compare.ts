// Asset comparison — pure functions, no I/O.
//
// Comparing assets is where a beginner most often draws the wrong conclusion,
// because the obvious comparison — which one went up more — ignores everything
// that made the ride different. Two assets can post the same five-year return
// with completely different volatility, drawdown and recovery, and only one of
// them was actually holdable.
//
// Everything here is computed on the SAME set of dates for every asset. A
// comparison over different windows is not a comparison.

import { calculateDailyReturns, calculateVolatility } from './analytics'
import { calculateCovarianceMatrix } from './covariance'
import { analyseDrawdowns } from './drawdown'
import { historicalVaR, conditionalVaR } from './var'
import { calculateSortinoRatio } from './asset-metrics'
import { TRADING_DAYS_PER_YEAR as TRADING_DAYS } from '@/lib/constants/financial-constants'

export type Bar = { date: string; close: number }


export type AssetComparison = {
  symbol: string
  observations: number
  /** Total return over the common window, as a percentage. */
  totalReturnPct: number
  cagrPct: number
  volatilityPct: number
  sharpe: number | null
  sortino: number | null
  /** Against the benchmark, when one is supplied. */
  beta: number | null
  maxDrawdownPct: number
  /** Gain needed to undo that worst drawdown. */
  recoveryRequiredPct: number
  longestRecoveryDays: number | null
  var95Pct: number | null
  cvar95Pct: number | null
  /** Value of a fixed sum invested at the start, for the normalised chart. */
  finalValueOfInitial: number
}

export type ComparisonResult = {
  from: string
  to: string
  observations: number
  initialInvestment: number
  assets: AssetComparison[]
  /** Symbol-by-symbol correlation of daily returns over the common window. */
  correlations: Array<{ a: string; b: string; correlation: number }>
  /** One normalised series per asset: the same sum invested in each. */
  normalised: Array<{ date: string; values: Record<string, number> }>
  /** Symbols dropped for having no overlap with the rest. */
  excluded: string[]
  note: string
}

function yearsBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`)
  const b = Date.parse(`${to}T00:00:00Z`)
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 0
  return (b - a) / (365 * 86_400_000)
}

/**
 * Compare several assets over the window all of them share.
 *
 * Restricting to common dates is not a detail. A five-year winner compared
 * against a two-year newcomer over their own windows is comparing a bull market
 * to a different market, and the resulting table would be nonsense presented as
 * analysis.
 */
export function compareAssets(
  seriesBySymbol: Record<string, Bar[]>,
  options: {
    initialInvestment?: number
    riskFreeRate?: number
    benchmarkSymbol?: string
  } = {},
): ComparisonResult | null {
  const symbols = Object.keys(seriesBySymbol)
  if (symbols.length === 0) return null

  const initialInvestment = options.initialInvestment ?? 10_000
  const riskFreeRate = options.riskFreeRate ?? 0

  const priceMaps = new Map<string, Map<string, number>>()
  for (const symbol of symbols) {
    const usable = (seriesBySymbol[symbol] ?? []).filter(
      (b) => Number.isFinite(b.close) && b.close > 0,
    )
    if (usable.length > 0) priceMaps.set(symbol, new Map(usable.map((b) => [b.date, b.close])))
  }

  const priced = [...priceMaps.keys()]
  if (priced.length === 0) return null

  const commonDates = [...priceMaps.get(priced[0])!.keys()]
    .filter((date) => priced.every((s) => priceMaps.get(s)!.has(date)))
    .sort()

  if (commonDates.length < 10) return null

  const excluded = symbols.filter((s) => !priced.includes(s))
  const closesBySymbol = new Map<string, number[]>(
    priced.map((s) => [s, commonDates.map((d) => priceMaps.get(s)!.get(d)!)]),
  )
  const returnsBySymbol = new Map<string, number[]>(
    priced.map((s) => [s, calculateDailyReturns(closesBySymbol.get(s)!)]),
  )

  const benchmarkReturns = options.benchmarkSymbol
    ? returnsBySymbol.get(options.benchmarkSymbol)
    : undefined

  const from = commonDates[0]
  const to = commonDates[commonDates.length - 1]
  const years = yearsBetween(from, to)

  const assets: AssetComparison[] = priced.map((symbol) => {
    const closes = closesBySymbol.get(symbol)!
    const returns = returnsBySymbol.get(symbol)!

    const totalReturn = closes[closes.length - 1] / closes[0] - 1
    const annualVol = calculateVolatility(returns)
    const annualReturn =
      returns.length > 0 ? (returns.reduce((a, b) => a + b, 0) / returns.length) * TRADING_DAYS : 0

    const drawdowns = analyseDrawdowns(
      commonDates.map((date, i) => ({ date, value: closes[i] })),
    )

    // Beta against the benchmark, computed over the same common window rather
    // than whatever history each asset happens to have.
    let beta: number | null = null
    if (benchmarkReturns && benchmarkReturns.length === returns.length && symbol !== options.benchmarkSymbol) {
      const cov = calculateCovarianceMatrix([returns, benchmarkReturns])
      beta = cov[1][1] > 1e-20 ? cov[0][1] / cov[1][1] : null
    }

    const var95 = historicalVaR(returns, 95)
    const cvar95 = conditionalVaR(returns, 95)

    return {
      symbol,
      observations: closes.length,
      totalReturnPct: totalReturn * 100,
      cagrPct: years > 0 ? (Math.pow(1 + totalReturn, 1 / years) - 1) * 100 : 0,
      volatilityPct: annualVol * 100,
      sharpe: annualVol > 1e-10 ? (annualReturn - riskFreeRate) / annualVol : null,
      sortino: calculateSortinoRatio(returns, riskFreeRate),
      beta,
      maxDrawdownPct: drawdowns.maxDrawdownPct,
      recoveryRequiredPct:
        drawdowns.maxDrawdownPct > 0 && drawdowns.maxDrawdownPct < 100
          ? (1 / (1 - drawdowns.maxDrawdownPct / 100) - 1) * 100
          : 0,
      longestRecoveryDays: drawdowns.longestRecoveryDays,
      var95Pct: var95 === null ? null : var95 * 100,
      cvar95Pct: cvar95 === null ? null : cvar95 * 100,
      finalValueOfInitial: initialInvestment * (1 + totalReturn),
    }
  })

  // Correlation of every pair, which is the number that decides whether holding
  // both of them is diversification or duplication.
  const correlations: ComparisonResult['correlations'] = []
  for (let i = 0; i < priced.length; i++) {
    for (let j = i + 1; j < priced.length; j++) {
      const a = returnsBySymbol.get(priced[i])!
      const b = returnsBySymbol.get(priced[j])!
      const cov = calculateCovarianceMatrix([a, b])
      const denominator = Math.sqrt(cov[0][0] * cov[1][1])
      correlations.push({
        a: priced[i],
        b: priced[j],
        correlation: denominator > 1e-20 ? cov[0][1] / denominator : 0,
      })
    }
  }

  const normalised = commonDates.map((date, i) => {
    const values: Record<string, number> = {}
    for (const symbol of priced) {
      const closes = closesBySymbol.get(symbol)!
      values[symbol] = (initialInvestment * closes[i]) / closes[0]
    }
    return { date, values }
  })

  return {
    from,
    to,
    observations: commonDates.length,
    initialInvestment,
    assets,
    correlations,
    normalised,
    excluded,
    note:
      'Todo se mide sobre las mismas fechas para todos los activos. Comparar cada uno sobre su ' +
      'propia historia sería comparar periodos distintos, no activos. El que más subió no es ' +
      'necesariamente el que valía la pena tener: mira también la caída máxima y cuánto tardó en ' +
      'recuperarse.',
  }
}
