// Factor model — pure functions, no I/O.
//
// A single beta against the market says how much of a portfolio's movement the
// market explains. It says nothing about WHY the rest moves. Factor regression
// splits that remainder into named, recognisable tilts: small companies versus
// large, cheap versus expensive, recent winners versus losers.
//
// The educational payoff is uncomfortable and worth delivering: most of what
// looks like stock-picking skill turns out to be a factor tilt that could have
// been bought for a few basis points. An alpha that survives the regression is a
// different claim from an alpha measured against the market alone.
//
// ── What these factors are, and are not ─────────────────────────────────────
//
// These are ETF PROXIES, not the Fama-French research factors. The academic
// series are built from thousands of individual stocks rebalanced on a strict
// schedule; these are long/short pairs of liquid ETFs that move for broadly the
// same reasons. They are close enough to teach the concept and they are priced
// by the same market data the rest of the app already uses. They are not the
// same thing, every definition below says so, and `isProxy` is on every one.

const TRADING_DAYS = 252

/** |t| at or above this is conventionally called significant. Roughly 95%. */
const T_SIGNIFICANCE = 2

/** Below this a standard error is numerically zero, not small. */
const MIN_STANDARD_ERROR = 1e-12

/** A pivot smaller than this means the normal equations are singular. */
const SINGULAR_PIVOT = 1e-14

export type FactorDefinition = {
  id: string
  name: string
  /** The symbols the series is built from, long first. */
  symbols: string[]
  /** How the return series is constructed from those symbols. */
  construction: string
  /** What a positive loading on it tells the reader. */
  meaning: string
  /** Always true here. See the header. */
  isProxy: true
}

/**
 * The factor set, each built from liquid ETFs the market data chain already
 * covers. Long minus short, so a positive value means the tilt paid that day.
 */
export const FACTOR_DEFINITIONS: FactorDefinition[] = [
  {
    id: 'market',
    name: 'Mercado',
    symbols: ['SPY'],
    construction:
      'Rendimiento diario del SPY (S&P 500) menos la tasa libre de riesgo diaria. Es el factor de mercado clasico: lo que ganas simplemente por estar invertido.',
    meaning:
      'Una carga cercana a 1 significa que te mueves como el mercado. Por encima de 1, amplificas sus movimientos en ambas direcciones; por debajo, los amortiguas.',
    isProxy: true,
  },
  {
    id: 'size',
    name: 'Tamano (pequenas menos grandes)',
    symbols: ['IWM', 'SPY'],
    construction:
      'Rendimiento del IWM (Russell 2000, empresas pequenas) menos el del SPY (empresas grandes). Aproxima el factor SMB de Fama-French con dos ETF en vez de miles de acciones.',
    meaning:
      'Carga positiva: tu cartera se comporta como empresas pequenas, que historicamente rinden mas y caen mas fuerte. Carga negativa: te pareces a las grandes.',
    isProxy: true,
  },
  {
    id: 'value',
    name: 'Valor (baratas menos caras)',
    symbols: ['IWD', 'IWF'],
    construction:
      'Rendimiento del IWD (Russell 1000 Value) menos el del IWF (Russell 1000 Growth). Aproxima el factor HML de Fama-French.',
    meaning:
      'Carga positiva: tu cartera se comporta como acciones baratas respecto a sus fundamentales. Carga negativa: te inclinas a crecimiento, que es donde ha estado la ultima decada.',
    isProxy: true,
  },
  {
    id: 'momentum',
    name: 'Momentum',
    symbols: ['MTUM', 'SPY'],
    construction:
      'Rendimiento del MTUM (MSCI USA Momentum) menos el del SPY. Aproxima el factor WML: comprar lo que viene subiendo.',
    meaning:
      'Carga positiva: tu cartera tiende a llevar lo que ya venia ganando. Es un factor con buen historial y caidas bruscas cuando el mercado gira.',
    isProxy: true,
  },
  {
    id: 'quality',
    name: 'Calidad',
    symbols: ['QUAL', 'SPY'],
    construction:
      'Rendimiento del QUAL (MSCI USA Quality) menos el del SPY. Empresas con balances solidos y beneficios estables frente al mercado general.',
    meaning:
      'Carga positiva: tu cartera se parece a empresas rentables y poco endeudadas, que suelen aguantar mejor en las caidas.',
    isProxy: true,
  },
  {
    id: 'lowVolatility',
    name: 'Baja volatilidad',
    symbols: ['USMV', 'SPY'],
    construction:
      'Rendimiento del USMV (MSCI USA Minimum Volatility) menos el del SPY. Acciones que se mueven poco frente al mercado general.',
    meaning:
      'Carga positiva: tu cartera se comporta como acciones tranquilas. Historicamente han dado un rendimiento ajustado por riesgo mejor de lo que la teoria predice.',
    isProxy: true,
  },
]

export type FactorBar = { date: string; close: number }

export type BuiltFactor = FactorSeries & { id: string }

export type BuiltFactorReturns = {
  /** The dates each return belongs to, ascending. One per return. */
  dates: string[]
  factors: BuiltFactor[]
  /** Factors that could not be built, and why. */
  omitted: Array<{ id: string; missing: string[] }>
}

/** A regression needs more rows than parameters, with room left to measure error. */
const MIN_FACTOR_OBSERVATIONS = 3

function dailyCloses(bars: FactorBar[] | undefined): Map<string, number> | null {
  if (!bars || bars.length === 0) return null
  const map = new Map<string, number>()
  for (const bar of bars) {
    if (Number.isFinite(bar.close) && bar.close > 0) map.set(bar.date, bar.close)
  }
  return map.size > 0 ? map : null
}

/**
 * Turn ETF price histories into the long-minus-short return series.
 *
 * Every factor is built on the SAME date grid — the intersection of the dates
 * all its symbols have — because a regression that lines up factor returns from
 * different days is regressing on a series nobody could have held.
 *
 * The market factor is the only one the risk-free rate is subtracted from. The
 * pairs are self-financing by construction: the short leg funds the long one, so
 * charging them for borrowing money they never borrow would bias every loading.
 *
 * A factor whose symbols are missing is omitted and reported, never approximated.
 * The market factor is the exception: without it there is no regression worth
 * running, so its absence returns null for the whole thing.
 */
export function buildFactorReturns(
  prices: Map<string, FactorBar[]>,
  riskFreeAnnual: number,
): BuiltFactorReturns | null {
  const closes = new Map<string, Map<string, number>>()
  for (const [symbol, bars] of prices) {
    const map = dailyCloses(bars)
    if (map) closes.set(symbol, map)
  }

  const buildable = FACTOR_DEFINITIONS.filter((f) => f.symbols.every((s) => closes.has(s)))
  const omitted = FACTOR_DEFINITIONS.filter((f) => !buildable.includes(f)).map((f) => ({
    id: f.id,
    missing: f.symbols.filter((s) => !closes.has(s)),
  }))

  const market = buildable.find((f) => f.id === 'market')
  if (!market) return null

  // One grid for every factor: the dates every symbol any buildable factor needs
  // actually has. Aligning per factor would give each one a different history.
  const required = [...new Set(buildable.flatMap((f) => f.symbols))]
  const first = closes.get(required[0])!
  const dates = [...first.keys()]
    .filter((date) => required.every((symbol) => closes.get(symbol)!.has(date)))
    .sort()

  if (dates.length < MIN_FACTOR_OBSERVATIONS + 1) return null

  const dailyRiskFree = Number.isFinite(riskFreeAnnual) ? riskFreeAnnual / TRADING_DAYS : 0

  const returnsFor = (symbol: string): number[] => {
    const map = closes.get(symbol)!
    const out: number[] = []
    for (let i = 1; i < dates.length; i++) {
      const previous = map.get(dates[i - 1])!
      const current = map.get(dates[i])!
      out.push(previous > 0 ? (current - previous) / previous : 0)
    }
    return out
  }

  const factors: BuiltFactor[] = []
  for (const definition of buildable) {
    const long = returnsFor(definition.symbols[0])
    const short = definition.symbols[1] ? returnsFor(definition.symbols[1]) : null

    const series = long.map((value, i) =>
      short ? value - short[i] : value - dailyRiskFree,
    )

    if (!series.every(Number.isFinite)) continue
    factors.push({ id: definition.id, name: definition.name, returns: series })
  }

  if (!factors.some((f) => f.id === 'market')) return null

  return { dates: dates.slice(1), factors, omitted }
}

export type FactorSeries = { name: string; returns: number[] }

export type FactorLoading = {
  factor: string
  coefficient: number
  standardError: number
  /** Null when the fit is exact and the ratio would be infinite. */
  tStat: number | null
  significant: boolean
}

export type FactorRegression = {
  /** Intercept, annualised and in percent. */
  alphaAnnualPct: number
  /** Standard error of that intercept, annualised the same way. */
  alphaStandardErrorAnnualPct: number
  alphaTStat: number | null
  loadings: FactorLoading[]
  rSquared: number
  adjustedRSquared: number
  /** Annualised volatility of what the factors do NOT explain. */
  residualVolatilityPct: number
  observations: number
}

/**
 * Invert a small symmetric matrix by Gauss-Jordan with partial pivoting.
 *
 * Returns null when the matrix is singular, which is what perfectly collinear
 * factors produce. That case has no unique answer, and returning one anyway
 * would mean reporting a made-up split of a shared effect between two factors.
 */
function invert(matrix: number[][]): number[][] | null {
  const n = matrix.length
  const a = matrix.map((row, i) => [
    ...row,
    ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  ])

  for (let col = 0; col < n; col++) {
    let pivotRow = col
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivotRow][col])) pivotRow = row
    }
    if (Math.abs(a[pivotRow][col]) < SINGULAR_PIVOT) return null

    const temp = a[col]
    a[col] = a[pivotRow]
    a[pivotRow] = temp

    const pivot = a[col][col]
    for (let j = 0; j < 2 * n; j++) a[col][j] /= pivot

    for (let row = 0; row < n; row++) {
      if (row === col) continue
      const factor = a[row][col]
      if (factor === 0) continue
      for (let j = 0; j < 2 * n; j++) a[row][j] -= factor * a[col][j]
    }
  }

  const inverse = a.map((row) => row.slice(n))
  return inverse.every((row) => row.every(Number.isFinite)) ? inverse : null
}

/**
 * Ordinary least squares of a return series on a set of factor series.
 *
 * Solved through the normal equations with an explicit inverse rather than a
 * QR decomposition, because the inverse is needed anyway: the standard errors
 * come from its diagonal, and without standard errors there is no way to tell a
 * real tilt from a coincidence. Reporting a coefficient with no sense of its
 * precision is how noise gets presented as a finding.
 */
export function runFactorRegression(
  returns: number[],
  factors: FactorSeries[],
): FactorRegression | null {
  const k = factors.length
  if (k === 0) return null

  const n = returns.length
  // Each factor costs a degree of freedom, plus the intercept, and a fit with
  // nothing left over has no residual to estimate precision from.
  if (n < k + 3) return null
  if (!returns.every(Number.isFinite)) return null
  if (factors.some((f) => f.returns.length !== n)) return null
  if (factors.some((f) => !f.returns.every(Number.isFinite))) return null

  // Design matrix with the intercept in column 0.
  const columns = k + 1
  const X: number[][] = Array.from({ length: n }, (_, t) => [
    1,
    ...factors.map((f) => f.returns[t]),
  ])

  // X'X and X'y
  const xtx: number[][] = Array.from({ length: columns }, (_, i) =>
    Array.from({ length: columns }, (_, j) => {
      let sum = 0
      for (let t = 0; t < n; t++) sum += X[t][i] * X[t][j]
      return sum
    }),
  )
  const xty: number[] = Array.from({ length: columns }, (_, i) => {
    let sum = 0
    for (let t = 0; t < n; t++) sum += X[t][i] * returns[t]
    return sum
  })

  const inverse = invert(xtx)
  if (!inverse) return null

  const beta = Array.from({ length: columns }, (_, i) => {
    let sum = 0
    for (let j = 0; j < columns; j++) sum += inverse[i][j] * xty[j]
    return sum
  })
  if (!beta.every(Number.isFinite)) return null

  // Residuals, and the two sums of squares R² is built from.
  const mean = returns.reduce((a, b) => a + b, 0) / n
  let rss = 0
  let tss = 0
  for (let t = 0; t < n; t++) {
    let fitted = 0
    for (let i = 0; i < columns; i++) fitted += beta[i] * X[t][i]
    const residual = returns[t] - fitted
    rss += residual * residual
    tss += (returns[t] - mean) * (returns[t] - mean)
  }

  // A series that never moves has no variation to explain, so R² is undefined
  // rather than 0 or 1, and the whole regression is meaningless.
  if (!(tss > 0)) return null

  const degreesOfFreedom = n - columns
  const residualVariance = rss / degreesOfFreedom
  if (!Number.isFinite(residualVariance) || residualVariance < 0) return null

  const standardErrors = Array.from({ length: columns }, (_, i) => {
    const variance = residualVariance * inverse[i][i]
    return variance > 0 ? Math.sqrt(variance) : 0
  })

  // A zero standard error means the factors reproduce the series exactly. The
  // naive ratio is Infinity, which must never reach the interface; null plus an
  // explicit significance decision says the same thing honestly.
  const tStatFor = (i: number): number | null =>
    standardErrors[i] > MIN_STANDARD_ERROR ? beta[i] / standardErrors[i] : null

  const significantFor = (i: number): boolean => {
    const t = tStatFor(i)
    // Significance in the limit, not the absence of it.
    if (t === null) return Math.abs(beta[i]) > 1e-12
    return Math.abs(t) >= T_SIGNIFICANCE
  }

  const rSquared = Math.min(1, Math.max(0, 1 - rss / tss))
  const adjustedRSquared =
    degreesOfFreedom > 0 ? 1 - (1 - rSquared) * ((n - 1) / degreesOfFreedom) : rSquared

  const result: FactorRegression = {
    alphaAnnualPct: beta[0] * TRADING_DAYS * 100,
    alphaStandardErrorAnnualPct: standardErrors[0] * TRADING_DAYS * 100,
    alphaTStat: tStatFor(0),
    loadings: factors.map((factor, index) => ({
      factor: factor.name,
      coefficient: beta[index + 1],
      standardError: standardErrors[index + 1],
      tStat: tStatFor(index + 1),
      significant: significantFor(index + 1),
    })),
    rSquared,
    adjustedRSquared: Math.min(1, adjustedRSquared),
    residualVolatilityPct: Math.sqrt(residualVariance * TRADING_DAYS) * 100,
    observations: n,
  }

  const finite =
    Number.isFinite(result.alphaAnnualPct) &&
    Number.isFinite(result.alphaStandardErrorAnnualPct) &&
    Number.isFinite(result.rSquared) &&
    Number.isFinite(result.adjustedRSquared) &&
    Number.isFinite(result.residualVolatilityPct) &&
    result.loadings.every(
      (l) => Number.isFinite(l.coefficient) && Number.isFinite(l.standardError),
    )

  return finite ? result : null
}

/** Above this, the factors explain most of what the portfolio does. */
const WELL_EXPLAINED = 0.7
/** Below this, they barely explain anything. */
const POORLY_EXPLAINED = 0.3

/**
 * The regression in words, with the part nobody wants to hear left in.
 *
 * An alpha whose t-statistic is below 2 is not a small skill, it is a number
 * indistinguishable from luck, and saying so is the whole reason this function
 * exists rather than the interface formatting the numbers itself.
 */
export function describeFactorExposure(regression: FactorRegression): string {
  const real = regression.loadings.filter((l) => l.significant)
  const explained = (regression.rSquared * 100).toFixed(0)

  const fit =
    regression.rSquared >= WELL_EXPLAINED
      ? `Estos factores explican el ${explained}% de como se mueve tu cartera. Es mucho: la mayor parte de lo que hace tu dinero no es seleccion de activos, es exposicion a estos riesgos conocidos.`
      : regression.rSquared <= POORLY_EXPLAINED
        ? `Estos factores solo explican el ${explained}% de como se mueve tu cartera. O tienes algo genuinamente distinto, o tienes muy pocas posiciones y domina el ruido de cada una.`
        : `Estos factores explican el ${explained}% de como se mueve tu cartera; el resto viene de lo especifico de tus posiciones.`

  const tilts = real.length
    ? ` Tus inclinaciones reales son: ${real
        .map((l) => `${l.factor} (${l.coefficient >= 0 ? '+' : ''}${l.coefficient.toFixed(2)})`)
        .join(', ')}.`
    : ' Ninguna de las inclinaciones medidas se distingue del ruido: con estos datos no se puede afirmar que tengas ninguna en particular.'

  const alphaValue = regression.alphaAnnualPct.toFixed(2)
  const alphaSignificant =
    regression.alphaTStat === null
      ? Math.abs(regression.alphaAnnualPct) > 0
      : Math.abs(regression.alphaTStat) >= T_SIGNIFICANCE

  const alpha = alphaSignificant
    ? ` Tras descontar esas exposiciones queda un alfa de ${alphaValue}% anual que SI se distingue estadisticamente de cero en este periodo.`
    : ` Queda un alfa de ${alphaValue}% anual, pero no se distingue estadisticamente de cero: con estos datos es indistinguible de la casualidad, y tratarlo como habilidad seria leer ruido.`

  const residual = ` Lo que los factores no explican se mueve un ${regression.residualVolatilityPct.toFixed(1)}% anual: ese es el riesgo que asumes sin que ningun factor conocido te pague por el.`

  const proxy =
    ' Nota: estos factores se aproximan con ETF cotizados, no son las series academicas de Fama-French. Sirven para ver la forma de tus exposiciones, no para publicar un paper.'

  return fit + tilts + alpha + residual + proxy
}
