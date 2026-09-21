// Sources of risk (P2-5) — pure functions, no I/O.
//
// "¿Cuáles son las verdaderas fuentes de riesgo de mi portafolio?"
//
// The risk tab already answers pieces of this separately: how much of the
// volatility each holding produces, how many independent bets the book runs,
// its beta to a benchmark, its factor tilts. Each answer used its own window,
// its own portfolio series and its own notion of "the risk", so they could not
// be read side by side, let alone added up.
//
// Here every view decomposes the SAME number — the variance of the book's
// returns on one aligned window, holding today's weights — and every
// decomposition adds up to it exactly:
//
//   by asset      Euler:      σ²_p = Σ_i w_i (Σw)_i
//   by sector     the asset contributions summed within each sector
//   by component  PCA:        σ²_p = Σ_k λ_k (w·v_k)²        (orthonormal v_k)
//   by factor     OLS:        σ²_p = bᵀ F b + σ²_ε,  and bᵀ F b = Σ_k b_k (F b)_k
//   by market     one index:  σ²_p = β² σ²_m + σ²_ε          (β² σ²_m / σ²_p = ρ²)
//
// The factor and market splits are exact in-sample: with an intercept, OLS
// residuals are uncorrelated with the fitted values, so the variance of the
// fitted part and of the residual add to the variance of the series, with the
// same n-1 denominator everywhere.
//
// Everything here describes the past window. None of it is a forecast, and none
// of it is a recommendation to change a position.

import { calculateCovarianceMatrix } from './covariance'
import { effectiveIndependentBets, jacobiEigen } from './pca'
import { runFactorRegression } from './factors'
import { realSector } from './sectors'

export type RiskSourcesInput = {
  symbols: string[]
  /** Current weights, one per symbol. Normalised here. */
  weights: number[]
  /** One per-bar return series per symbol, aligned by date, all the same length. */
  returnsMatrix: number[][]
  /** Bars per year, from the detected cadence (252 for daily bars). */
  periodsPerYear: number
  /** Sector per symbol; missing or null lands in "Sin clasificar". */
  sectors?: Record<string, string | null | undefined>
  /** Benchmark returns on the same bars, or omitted. */
  benchmark?: { symbol: string; name: string; returns: number[] } | null
  /** Factor returns on the same bars, or omitted. */
  factors?: Array<{ id: string; name: string; returns: number[] }> | null
}

export type AssetRiskSource = {
  symbol: string
  sector: string
  weightPct: number
  /** Annualised standalone volatility, %. */
  volatilityPct: number
  /** Correlation of the asset with the book as a whole. */
  correlationWithPortfolio: number
  /** Beta to the benchmark, when one is available. */
  betaToBenchmark: number | null
  /** Share of the book's variance, %. Can be negative for a hedge; all sum to 100. */
  percentOfRisk: number
}

export type SectorRiskSource = {
  sector: string
  weightPct: number
  percentOfRisk: number
  symbols: string[]
}

export type ComponentRiskSource = {
  /** 1 is the direction the holdings vary along most. */
  index: number
  /** Share of the BOOK's variance this direction carries, %. All sum to 100. */
  percentOfRisk: number
  /** Share of the holdings' total variance it explains regardless of weights, %. */
  varianceExplainedPct: number
  /**
   * The next or previous component explains almost as much. Directions with
   * near-equal variance are not uniquely defined — any rotation between them is
   * as valid — so how the book's risk splits between them is not a finding,
   * only their combined share is.
   */
  nearlyTied: boolean
  /** The holdings that define the direction, largest loading first. */
  loadings: Array<{ symbol: string; loading: number }>
}

export type FactorRiskSource = {
  id: string
  name: string
  /** Regression loading of the book on the factor. */
  exposure: number
  significant: boolean
  /** Share of the book's variance, %. Can be negative when a factor offsets another. */
  percentOfRisk: number
}

export type RiskSources = {
  observations: number
  /** Annualised volatility of the book on this window, %. */
  portfolioVolatilityPct: number
  byAsset: AssetRiskSource[]
  bySector: SectorRiskSource[]
  byComponent: {
    /**
     * Independent bets from the entropy of the eigenvalues, the same measure
     * as the risk tab's. Weight-free, and unlike the per-component shares it
     * does not depend on how tied directions happen to be rotated.
     */
    effectiveBets: number
    components: ComponentRiskSource[]
  } | null
  byFactor: {
    /** Share the factors explain together (R²), %. */
    explainedPct: number
    /** Share specific to these holdings, what no factor explains, %. */
    specificPct: number
    factors: FactorRiskSource[]
  } | null
  market: {
    symbol: string
    name: string
    beta: number
    correlation: number
    /** Share of the book's variance the benchmark accounts for (ρ²), %. */
    systematicPct: number
    specificPct: number
  } | null
  correlation: {
    /** Weighted average correlation between different holdings. */
    averagePairwise: number | null
    highestPair: { a: string; b: string; correlation: number } | null
  }
  /** The answer to the question, one finding per sentence, largest source first. */
  findings: string[]
}

const UNCLASSIFIED = 'Sin clasificar'

/** What a holding's asset type reads as when there is no company sector for it. */
const ASSET_TYPE_LABELS: Record<string, string> = {
  stock: 'Acciones (sin sector)',
  etf: 'ETF',
  index: 'Índices',
  crypto: 'Cripto',
  bond: 'Renta fija',
  forex: 'Divisas',
  commodity: 'Materias primas',
}

// Moved to sectors.ts so the concentration rule can use it without pulling in
// the covariance and factor machinery; re-exported here for existing callers.
export { realSector }

/** The sector a holding is grouped under: the company's, else its asset type, else unclassified. */
export function sectorLabel(companySector: string | null | undefined, assetType: string | null | undefined): string {
  const sector = realSector(companySector)
  if (sector) return sector
  const type = assetType?.trim().toLowerCase()
  if (!type) return UNCLASSIFIED
  return ASSET_TYPE_LABELS[type] ?? type.charAt(0).toUpperCase() + type.slice(1)
}

/** Fewer returns than this and a covariance matrix is mostly noise. */
export const MIN_RISK_OBSERVATIONS = 20

/** Loadings below this in absolute value do not define a component. */
const LOADING_SHOWN = 0.2

/** Eigenvalues closer than this ratio are treated as tied. */
const TIE_RATIO = 1.15

const finite = (value: number) => Number.isFinite(value)

function mean(series: number[]): number {
  return series.reduce((a, b) => a + b, 0) / series.length
}

/** Sample covariance with the n-1 denominator, matching calculateCovarianceMatrix. */
function covariance(a: number[], b: number[]): number {
  const ma = mean(a)
  const mb = mean(b)
  let sum = 0
  for (let t = 0; t < a.length; t++) sum += (a[t] - ma) * (b[t] - mb)
  return sum / (a.length - 1)
}

function round(value: number, decimals = 4): number {
  const f = 10 ** decimals
  return Math.round(value * f) / f
}

function pct(value: number): string {
  return `${value.toFixed(0)}%`
}

/**
 * Decompose the book's risk every way the question can be asked.
 *
 * Returns null when there is nothing honest to decompose: mismatched inputs,
 * too few observations, a book with no value, or one that never moved.
 */
export function analyseRiskSources(input: RiskSourcesInput): RiskSources | null {
  const { symbols, returnsMatrix, periodsPerYear } = input
  const n = symbols.length
  if (n === 0 || input.weights.length !== n || returnsMatrix.length !== n) return null
  if (!(periodsPerYear > 0)) return null

  const T = returnsMatrix[0]?.length ?? 0
  if (T < MIN_RISK_OBSERVATIONS || returnsMatrix.some((r) => r.length !== T || !r.every(finite))) return null

  const grossWeight = input.weights.reduce((sum, w) => sum + (finite(w) ? w : NaN), 0)
  if (!(grossWeight > 0)) return null
  const weights = input.weights.map((w) => w / grossWeight)

  // Per-bar covariance and the book's per-bar returns under today's weights.
  const cov = calculateCovarianceMatrix(returnsMatrix)
  if (cov.length !== n || !cov.every((row) => row.every(finite))) return null
  const portfolioReturns = Array.from({ length: T }, (_, t) =>
    weights.reduce((sum, w, i) => sum + w * returnsMatrix[i][t], 0),
  )

  const sigmaW = cov.map((row) => row.reduce((sum, c, j) => sum + c * weights[j], 0))
  const variance = sigmaW.reduce((sum, v, i) => sum + weights[i] * v, 0)
  if (!(variance > 0) || !finite(variance)) return null
  const sigma = Math.sqrt(variance)
  const annualise = (perBarVariance: number) => Math.sqrt(perBarVariance * periodsPerYear) * 100

  const sectorOf = (symbol: string) => input.sectors?.[symbol]?.trim() || UNCLASSIFIED

  // ── Benchmark ─────────────────────────────────────────────────────────────
  const benchmarkReturns =
    input.benchmark && input.benchmark.returns.length === T && input.benchmark.returns.every(finite)
      ? input.benchmark.returns
      : null
  const benchmarkVariance = benchmarkReturns ? covariance(benchmarkReturns, benchmarkReturns) : 0

  // ── By asset (Euler) ──────────────────────────────────────────────────────
  const byAsset: AssetRiskSource[] = symbols.map((symbol, i) => {
    const ownVariance = Math.max(0, cov[i][i])
    const ownSigma = Math.sqrt(ownVariance)
    return {
      symbol,
      sector: sectorOf(symbol),
      weightPct: round(weights[i] * 100),
      volatilityPct: round(annualise(ownVariance)),
      // ρ(i, p) = cov(r_i, r_p) / (σ_i σ_p), and cov(r_i, r_p) = (Σw)_i.
      correlationWithPortfolio: ownSigma > 0 ? round(sigmaW[i] / (ownSigma * sigma)) : 0,
      betaToBenchmark:
        benchmarkReturns && benchmarkVariance > 0
          ? round(covariance(returnsMatrix[i], benchmarkReturns) / benchmarkVariance)
          : null,
      percentOfRisk: round(((weights[i] * sigmaW[i]) / variance) * 100),
    }
  })
  byAsset.sort((a, b) => b.percentOfRisk - a.percentOfRisk)

  // ── By sector ─────────────────────────────────────────────────────────────
  const sectorMap = new Map<string, SectorRiskSource>()
  for (const asset of byAsset) {
    const bucket = sectorMap.get(asset.sector) ?? { sector: asset.sector, weightPct: 0, percentOfRisk: 0, symbols: [] }
    bucket.weightPct += asset.weightPct
    bucket.percentOfRisk += asset.percentOfRisk
    bucket.symbols.push(asset.symbol)
    sectorMap.set(asset.sector, bucket)
  }
  const bySector = [...sectorMap.values()]
    .map((s) => ({ ...s, weightPct: round(s.weightPct), percentOfRisk: round(s.percentOfRisk) }))
    .sort((a, b) => b.percentOfRisk - a.percentOfRisk)

  // ── By principal component ───────────────────────────────────────────────
  let byComponent: RiskSources['byComponent'] = null
  // Scaled to a unit average variance first. Jacobi's convergence tolerance is
  // absolute, and per-bar covariances of daily returns (around 1e-4) are small
  // enough for it to stop at a visibly wrong rotation. The shares below are
  // ratios, so the scale cancels.
  const averageVariance = cov.reduce((sum, row, i) => sum + Math.max(0, row[i]), 0) / n
  const scaled = averageVariance > 0 ? cov.map((row) => row.map((c) => c / averageVariance)) : null
  const eigen = n >= 2 && scaled ? jacobiEigen(scaled) : null
  if (eigen) {
    const eigenvalues = eigen.eigenvalues.map((v) => Math.max(0, v))
    const totalEigen = eigenvalues.reduce((a, b) => a + b, 0)
    const scaledVariance = variance / averageVariance
    const shares = eigenvalues.map((lambda, k) => {
      const projection = eigen.eigenvectors[k].reduce((sum, v, i) => sum + v * weights[i], 0)
      return (lambda * projection * projection) / scaledVariance
    })
    const shareTotal = shares.reduce((a, b) => a + b, 0)
    const effectiveBets = effectiveIndependentBets(scaled!)
    if (totalEigen > 0 && shareTotal > 0 && shares.every(finite) && effectiveBets !== null) {
      const tied = (a: number, b: number) => a > 0 && b > 0 && Math.max(a, b) / Math.min(a, b) < TIE_RATIO
      byComponent = {
        effectiveBets: round(effectiveBets, 2),
        // PCA order: the direction the holdings vary along most comes first.
        components: shares.map((share, k) => ({
          index: k + 1,
          percentOfRisk: round((share / shareTotal) * 100),
          varianceExplainedPct: round((eigenvalues[k] / totalEigen) * 100),
          nearlyTied:
            (k > 0 && tied(eigenvalues[k - 1], eigenvalues[k])) ||
            (k < eigenvalues.length - 1 && tied(eigenvalues[k], eigenvalues[k + 1])),
          loadings: eigen.eigenvectors[k]
            .map((loading, i) => ({ symbol: symbols[i], loading: round(loading) }))
            .filter((l) => Math.abs(l.loading) >= LOADING_SHOWN)
            .sort((a, b) => Math.abs(b.loading) - Math.abs(a.loading)),
        })),
      }
    }
  }

  // ── By factor ─────────────────────────────────────────────────────────────
  let byFactor: RiskSources['byFactor'] = null
  const factorSeries = (input.factors ?? []).filter((f) => f.returns.length === T && f.returns.every(finite))
  if (factorSeries.length > 0) {
    const regression = runFactorRegression(
      portfolioReturns,
      factorSeries.map((f) => ({ name: f.name, returns: f.returns })),
    )
    if (regression) {
      const b = regression.loadings.map((l) => l.coefficient)
      const F = calculateCovarianceMatrix(factorSeries.map((f) => f.returns))
      const Fb = F.map((row) => row.reduce((sum, c, j) => sum + c * b[j], 0))
      const contributions = b.map((bk, k) => (bk * Fb[k]) / variance)
      if (contributions.every(finite)) {
        const explained = contributions.reduce((a, c) => a + c, 0)
        byFactor = {
          explainedPct: round(explained * 100),
          specificPct: round((1 - explained) * 100),
          factors: factorSeries
            .map((f, k) => ({
              id: f.id,
              name: f.name,
              exposure: round(b[k]),
              significant: regression.loadings[k].significant,
              percentOfRisk: round(contributions[k] * 100),
            }))
            .sort((x, y) => Math.abs(y.percentOfRisk) - Math.abs(x.percentOfRisk)),
        }
      }
    }
  }

  // ── Market ────────────────────────────────────────────────────────────────
  let market: RiskSources['market'] = null
  if (input.benchmark && benchmarkReturns && benchmarkVariance > 0) {
    const covPM = covariance(portfolioReturns, benchmarkReturns)
    const beta = covPM / benchmarkVariance
    const correlation = covPM / (Math.sqrt(benchmarkVariance) * sigma)
    if (finite(beta) && finite(correlation)) {
      const systematic = Math.min(1, correlation * correlation)
      market = {
        symbol: input.benchmark.symbol,
        name: input.benchmark.name,
        beta: round(beta),
        correlation: round(correlation),
        systematicPct: round(systematic * 100),
        specificPct: round((1 - systematic) * 100),
      }
    }
  }

  // ── Correlation between holdings ─────────────────────────────────────────
  let weightedCorrelation = 0
  let pairWeight = 0
  let highestPair: RiskSources['correlation']['highestPair'] = null
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const denominator = Math.sqrt(Math.max(0, cov[i][i]) * Math.max(0, cov[j][j]))
      if (!(denominator > 0)) continue
      const rho = cov[i][j] / denominator
      const w = weights[i] * weights[j]
      weightedCorrelation += w * rho
      pairWeight += w
      if (!highestPair || rho > highestPair.correlation) {
        highestPair = { a: symbols[i], b: symbols[j], correlation: round(rho) }
      }
    }
  }

  const result: RiskSources = {
    observations: T,
    portfolioVolatilityPct: round(annualise(variance)),
    byAsset,
    bySector,
    byComponent,
    byFactor,
    market,
    correlation: {
      averagePairwise: pairWeight > 0 ? round(weightedCorrelation / pairWeight) : null,
      highestPair,
    },
    findings: [],
  }
  result.findings = describeRiskSources(result)
  return result
}

/**
 * The answer in sentences, built only from the measured numbers.
 *
 * Descriptive on purpose: each sentence says where the past window's variation
 * came from, never what to buy or sell about it.
 */
export function describeRiskSources(sources: RiskSources): string[] {
  const findings: string[] = []

  const topAsset = sources.byAsset[0]
  if (topAsset) {
    const gap = topAsset.percentOfRisk - topAsset.weightPct
    findings.push(
      `${topAsset.symbol} genera el ${pct(topAsset.percentOfRisk)} del riesgo con el ${pct(topAsset.weightPct)} del dinero` +
        (Math.abs(gap) >= 10
          ? gap > 0
            ? ': pesa más en el riesgo que en la cartera.'
            : ': pesa menos en el riesgo que en la cartera.'
          : '.'),
    )
  }

  const topSector = sources.bySector[0]
  if (topSector && sources.bySector.length > 1) {
    findings.push(
      `Por sector, ${topSector.sector} concentra el ${pct(topSector.percentOfRisk)} del riesgo (${topSector.symbols.join(', ')}).`,
    )
  }

  if (sources.market) {
    findings.push(
      `El ${sources.market.name} explica el ${pct(sources.market.systematicPct)} de las variaciones del portafolio (beta ${sources.market.beta.toFixed(2)}); el ${pct(sources.market.specificPct)} restante no lo explica el mercado.`,
    )
  }

  // With the market as the only factor the split repeats the market sentence.
  if (sources.byFactor && sources.byFactor.factors.length > 1) {
    const real = sources.byFactor.factors.filter((f) => f.significant).slice(0, 2)
    findings.push(
      `Los factores explican juntos el ${pct(sources.byFactor.explainedPct)} del riesgo` +
        (real.length > 0
          ? `; los que más pesan son ${real.map((f) => `${f.name} (${pct(f.percentOfRisk)})`).join(' y ')}.`
          : ', sin ningún factor estadísticamente distinguible del azar.'),
    )
  }

  if (sources.byComponent && sources.byComponent.components.length > 1) {
    const { components, effectiveBets } = sources.byComponent
    const first = components[0]
    const drivers = first.loadings.slice(0, 3).map((l) => l.symbol).join(', ')
    findings.push(
      `En la práctica tus ${sources.byAsset.length} posiciones equivalen a ${effectiveBets.toFixed(1)} apuestas independientes` +
        (first.nearlyTied
          ? '.'
          : `: una sola dirección de movimiento${drivers ? ` (${drivers})` : ''} reúne el ${pct(first.percentOfRisk)} del riesgo del portafolio.`),
    )
  }

  if (sources.correlation.highestPair && sources.correlation.highestPair.correlation >= 0.8) {
    const pair = sources.correlation.highestPair
    findings.push(`${pair.a} y ${pair.b} se movieron casi igual (correlación ${pair.correlation.toFixed(2)}).`)
  }

  return findings
}

// ─── Lining up the benchmark and the factors ────────────────────────────────

/** Share of the holdings' intervals an optional series must cover to be used. */
export const MIN_SERIES_COVERAGE = 0.95

export type AlignedRiskInputs = {
  returnsMatrix: number[][]
  benchmarkReturns: number[] | null
  factors: Array<{ id: string; name: string; returns: number[] }> | null
  /** Intervals kept, out of those the holdings share. */
  intervalsUsed: number
  intervalsAvailable: number
  /** Why an optional series was left out, when it was. */
  omitted: { benchmark?: string; factors?: string }
}

/**
 * Put the benchmark and the factor series on exactly the holdings' intervals.
 *
 * The holdings' returns run from each common date to the next. The benchmark's
 * return over the same interval is taken from its own closes on those two
 * dates. The factors only exist as one-day returns, so an interval is usable
 * for them only when its two dates are consecutive on the factor grid; a
 * multi-day gap in the holdings' calendar has no factor return to match.
 *
 * Every view must decompose the same variance, so the optional series do not
 * get their own subsets: an interval either stays for all of them or goes. A
 * series that would cost more than 5% of the holdings' history is left out
 * instead, and says so.
 */
export function alignRiskInputs(input: {
  /** The holdings' common dates; returnsMatrix[i][t] runs from dates[t] to dates[t+1]. */
  dates: string[]
  returnsMatrix: number[][]
  benchmarkCloses?: Map<string, number> | null
  /** One-day factor returns, each dated by the day it was earned, on one ascending grid. */
  factorGrid?: { dates: string[]; factors: Array<{ id: string; name: string; returns: number[] }> } | null
}): AlignedRiskInputs {
  const intervals = Math.max(0, input.dates.length - 1)
  const all = Array.from({ length: intervals }, (_, t) => t)
  const omitted: AlignedRiskInputs['omitted'] = {}
  const covers = (kept: number[]) => intervals > 0 && kept.length / intervals >= MIN_SERIES_COVERAGE

  let keep = all

  const closes = input.benchmarkCloses ?? null
  let useBenchmark = false
  if (closes) {
    const withBenchmark = keep.filter((t) => (closes.get(input.dates[t]) ?? 0) > 0 && (closes.get(input.dates[t + 1]) ?? 0) > 0)
    if (covers(withBenchmark)) {
      keep = withBenchmark
      useBenchmark = true
    } else {
      omitted.benchmark = `El índice de referencia no tiene precio en ${intervals - withBenchmark.length} de ${intervals} periodos.`
    }
  }

  const grid = input.factorGrid ?? null
  let factorIndex: Map<string, number> | null = null
  if (grid && grid.factors.length > 0) {
    const index = new Map(grid.dates.map((d, i) => [d, i]))
    const usable = (t: number) => {
      const i = index.get(input.dates[t + 1])
      return i !== undefined && i > 0 && grid.dates[i - 1] === input.dates[t]
    }
    const withFactors = keep.filter(usable)
    if (covers(withFactors)) {
      keep = withFactors
      factorIndex = index
    } else {
      omitted.factors = `Las series de factores cubren ${all.filter(usable).length} de ${intervals} periodos.`
    }
  }

  return {
    returnsMatrix: input.returnsMatrix.map((series) => keep.map((t) => series[t])),
    benchmarkReturns: useBenchmark && closes
      ? keep.map((t) => closes.get(input.dates[t + 1])! / closes.get(input.dates[t])! - 1)
      : null,
    factors: factorIndex && grid
      ? grid.factors.map((f) => ({ id: f.id, name: f.name, returns: keep.map((t) => f.returns[factorIndex!.get(input.dates[t + 1])!]) }))
      : null,
    intervalsUsed: keep.length,
    intervalsAvailable: intervals,
    omitted,
  }
}
