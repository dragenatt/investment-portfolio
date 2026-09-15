// Portfolio Health (P2-7) — pure functions, no I/O.
//
// An EDUCATIONAL score. It grades how the portfolio is built — spread,
// concentration, risk and falls against its benchmark, liquidity, where its
// exposures sit — so a reader can see which parts of the construction are
// doing the work and which are not. It is not a recommendation to buy or sell
// anything, and it does not forecast.
//
// Every component shows what was measured, the threshold it was graded
// against and where that threshold comes from. Where a threshold is a
// regulation or an index weight it is cited; where it is InvestTracker's own
// convention it says so (docs/FINANCIAL_ASSUMPTIONS.md, "Portfolio Health").
// A component without the data it needs is reported as unavailable and left
// out of the average, never scored as zero or as perfect.

import type { RiskSources } from './risk-sources'
import { calculateMaxDrawdown } from './analytics'
import { geographicExposure } from './exposure'

export const HEALTH_COMPONENT_IDS = [
  'diversification',
  'concentration',
  'risk',
  'drawdown',
  'liquidity',
  'sector',
  'geography',
  'factors',
  'benchmark',
] as const
export type HealthComponentId = (typeof HEALTH_COMPONENT_IDS)[number]

export type HealthComponent = {
  id: HealthComponentId
  name: string
  /** 0–100, or null when the data it needs is not there. */
  score: number | null
  /** What was measured, in words with the number. */
  measured: string
  /** What the score is graded against. */
  threshold: string
  /** Where the threshold comes from: a citation or "convención educativa". */
  basis: string
  /** Why it is unavailable, when it is. */
  unavailableReason?: string
}

export type HealthBand = 'solida' | 'mejorable' | 'fragil'

export type PortfolioHealth = {
  /** Average of the available components, 0–100; null with too few of them. */
  score: number | null
  band: HealthBand | null
  bandLabel: string | null
  components: HealthComponent[]
  /** How many components entered the average. */
  componentsScored: number
  summary: string
  caveat: string
}

export type HealthHolding = {
  symbol: string
  weight: number
  quantity: number
  assetType: string | null
  /** Sector from company data only — never the asset-type fallback. */
  companySector: string | null
  currency: string | null
  country: string | null
  /** Average daily volume in shares over recent sessions, when stored. */
  averageDailyVolume: number | null
}

export type HealthInput = {
  holdings: HealthHolding[]
  /** Aligned per-bar returns per holding, in the holdings' order. */
  returnsMatrix: number[][]
  benchmarkReturns: number[] | null
  benchmarkName: string
  periodsPerYear: number
  riskSources: RiskSources
}

/** Fewer components than this and an average would be a grade on a fragment. */
export const MIN_COMPONENTS_FOR_SCORE = 4

export const HEALTH_CAVEAT =
  'Puntaje educativo: describe cómo está construido el portafolio con los datos del periodo, no predice su rendimiento ni es una recomendación de compra o venta. Los umbrales indican su origen; varios son convenciones de InvestTracker.'

const CONVENTION_INLINE = 'convención educativa de InvestTracker (docs/FINANCIAL_ASSUMPTIONS.md).'
const CONVENTION = CONVENTION_INLINE.charAt(0).toUpperCase() + CONVENTION_INLINE.slice(1)

/** 1 at or below `full`, 0 at or beyond `zero`, linear between — works in either direction. */
export function gradeLinear(value: number, full: number, zero: number): number {
  if (!Number.isFinite(value)) return 0
  const t = (value - full) / (zero - full)
  return Math.round(Math.min(1, Math.max(0, 1 - t)) * 100)
}

const pct = (value: number, decimals = 0) => `${value.toFixed(decimals)}%`

/** Asset types that are already a diversified basket rather than one issuer. */
const POOLED_TYPES = new Set(['etf', 'index', 'fund', 'mutual_fund'])

function unavailable(id: HealthComponentId, name: string, threshold: string, basis: string, reason: string): HealthComponent {
  return { id, name, score: null, measured: '—', threshold, basis, unavailableReason: reason }
}

// ─── Components ─────────────────────────────────────────────────────────────

function diversification(input: HealthInput): HealthComponent {
  const name = 'Diversificación'
  const threshold = '5 o más apuestas independientes = 100; 1 = 0.'
  const bets = input.riskSources.byComponent?.effectiveBets ?? null
  if (bets === null || input.holdings.length < 2) {
    return unavailable('diversification', name, threshold, CONVENTION, 'Se necesitan al menos dos posiciones con historial común.')
  }
  return {
    id: 'diversification',
    name,
    score: gradeLinear(bets, 5, 1),
    measured: `${input.holdings.length} posiciones equivalen a ${bets.toFixed(1)} apuestas independientes.`,
    threshold,
    basis: `Número efectivo de apuestas (entropía de los componentes principales). El umbral de 5 es una ${CONVENTION_INLINE}`,
  }
}

function concentration(input: HealthInput): HealthComponent {
  const name = 'Concentración'
  const threshold =
    'Promedio de dos notas: la mayor emisora individual (10% o menos = 100, 40% = 0) y la suma de las emisoras de más de 5% (40% o menos = 100, 100% = 0).'
  const basis =
    'Límites 5/10/40 de la Directiva UCITS 2009/65/CE, art. 52, pensados para fondos; dónde llega a cero cada nota y que se promedien son convención de InvestTracker. Los ETF e índices cuentan como canastas, no como una emisora.'
  const single = input.holdings.filter((h) => !POOLED_TYPES.has((h.assetType ?? '').toLowerCase()))
  if (single.length === 0) {
    return {
      id: 'concentration',
      name,
      score: 100,
      measured: 'Todo el portafolio está en ETF o índices, que ya reparten entre muchas emisoras.',
      threshold,
      basis,
    }
  }
  const weightsPct = single.map((h) => h.weight * 100)
  const largest = Math.max(...weightsPct)
  const largestSymbol = single[weightsPct.indexOf(largest)].symbol
  const aboveFive = weightsPct.filter((w) => w > 5).reduce((a, b) => a + b, 0)
  // Averaged, not the minimum: ten equal stocks break the 40% aggregate limit
  // outright, and grading that book zero would say it is as concentrated as a
  // single stock.
  const score = Math.round((gradeLinear(largest, 10, 40) + gradeLinear(aboveFive, 40, 100)) / 2)
  return {
    id: 'concentration',
    name,
    score,
    measured: `La mayor emisora individual es ${largestSymbol} con ${pct(largest, 1)}; las posiciones individuales de más de 5% suman ${pct(aboveFive, 1)}.`,
    threshold,
    basis,
  }
}

function annualVolatility(returns: number[], periodsPerYear: number): number {
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1)
  return Math.sqrt(variance * periodsPerYear) * 100
}

function portfolioReturns(input: HealthInput): number[] {
  const T = input.returnsMatrix[0]?.length ?? 0
  return Array.from({ length: T }, (_, t) => input.holdings.reduce((sum, h, i) => sum + h.weight * input.returnsMatrix[i][t], 0))
}

function valuePath(returns: number[]): number[] {
  const values = [1]
  for (const r of returns) values.push(values[values.length - 1] * (1 + r))
  return values
}

function risk(input: HealthInput, own: number[]): HealthComponent {
  const name = 'Riesgo'
  const threshold = 'Volatilidad igual o menor que la del benchmark = 100; el doble = 0.'
  const bench = input.benchmarkReturns
  if (!bench || bench.length !== own.length || own.length < 3) {
    return unavailable('risk', name, threshold, CONVENTION, 'No hay historial del benchmark en el mismo periodo.')
  }
  const mine = annualVolatility(own, input.periodsPerYear)
  const theirs = annualVolatility(bench, input.periodsPerYear)
  if (!(theirs > 0)) return unavailable('risk', name, threshold, CONVENTION, 'El benchmark no tuvo variación en el periodo.')
  const ratio = mine / theirs
  return {
    id: 'risk',
    name,
    score: gradeLinear(ratio, 1, 2),
    measured: `Volatilidad anual de ${pct(mine, 1)} frente a ${pct(theirs, 1)} de ${input.benchmarkName} (${ratio.toFixed(2)} veces).`,
    threshold,
    basis: CONVENTION,
  }
}

/** Below this, the benchmark's own fall is too small to grade against. */
const MIN_BENCHMARK_DRAWDOWN_PCT = 2

function drawdown(input: HealthInput, own: number[]): HealthComponent {
  const name = 'Caídas'
  const bench = input.benchmarkReturns
  const mine = calculateMaxDrawdown(valuePath(own))
  if (bench && bench.length === own.length) {
    const theirs = calculateMaxDrawdown(valuePath(bench))
    if (theirs >= MIN_BENCHMARK_DRAWDOWN_PCT) {
      const ratio = mine / theirs
      return {
        id: 'drawdown',
        name,
        score: gradeLinear(ratio, 1, 2),
        measured: `Peor caída de ${pct(mine, 1)} con los pesos actuales, frente a ${pct(theirs, 1)} de ${input.benchmarkName}.`,
        threshold: 'Caída máxima igual o menor que la del benchmark = 100; el doble = 0.',
        basis: CONVENTION,
      }
    }
  }
  return {
    id: 'drawdown',
    name,
    score: gradeLinear(mine, 10, 40),
    measured: `Peor caída de ${pct(mine, 1)} con los pesos actuales en el periodo.`,
    threshold: 'Sin una caída del benchmark con la cual comparar: 10% o menos = 100; 40% = 0.',
    basis: CONVENTION,
  }
}

/** Share of a day's volume a seller can take without moving the price much. */
export const LIQUIDITY_PARTICIPATION = 0.2
/** Business days within which a holding counts as highly liquid. */
export const HIGHLY_LIQUID_DAYS = 3

function liquidity(input: HealthInput): HealthComponent {
  const name = 'Liquidez'
  const threshold = `Porcentaje del valor que se vendería en ${HIGHLY_LIQUID_DAYS} días hábiles o menos negociando hasta ${LIQUIDITY_PARTICIPATION * 100}% del volumen diario.`
  const basis = `Categoría "altamente líquido" de la Regla 22e-4 de la SEC (3 días hábiles); el ${LIQUIDITY_PARTICIPATION * 100}% de participación en el volumen es convención de InvestTracker.`
  // An index is a number, not something anyone can sell.
  const tradable = input.holdings.filter((h) => !h.symbol.startsWith('^') && (h.assetType ?? '').toLowerCase() !== 'index')
  const measured = tradable.filter((h) => h.averageDailyVolume !== null && h.averageDailyVolume > 0)
  const measuredWeight = measured.reduce((s, h) => s + h.weight, 0)
  const tradableWeight = tradable.reduce((s, h) => s + h.weight, 0)
  if (measured.length === 0 || measuredWeight < tradableWeight * 0.5) {
    return unavailable('liquidity', name, threshold, basis, 'No hay volumen negociado suficiente registrado para estas posiciones.')
  }
  let liquidWeight = 0
  let slowest: { symbol: string; days: number } | null = null
  for (const h of measured) {
    const days = h.quantity / (LIQUIDITY_PARTICIPATION * h.averageDailyVolume!)
    if (days <= HIGHLY_LIQUID_DAYS) liquidWeight += h.weight
    if (!slowest || days > slowest.days) slowest = { symbol: h.symbol, days }
  }
  const share = (liquidWeight / measuredWeight) * 100
  return {
    id: 'liquidity',
    name,
    score: Math.round(share),
    measured:
      `${pct(share)} del valor medido se vendería en ${HIGHLY_LIQUID_DAYS} días hábiles o menos` +
      (slowest ? `; la más lenta es ${slowest.symbol} (${slowest.days < 0.01 ? 'menos de 0.01' : slowest.days.toFixed(2)} días).` : '.'),
    threshold,
    basis,
  }
}

function sector(input: HealthInput): HealthComponent {
  const name = 'Exposición sectorial'
  const threshold = 'Ningún sector sobre 35% del portafolio = 100; 70% = 0.'
  const basis = `El 35% es el umbral de concentración sectorial que ya usa la vista de exposición; el cero en 70% es ${CONVENTION_INLINE}`
  const classified = input.holdings.filter((h) => h.companySector)
  const coverage = classified.reduce((s, h) => s + h.weight, 0)
  if (coverage < 0.5) {
    return unavailable('sector', name, threshold, basis, `Solo ${pct(coverage * 100)} del portafolio tiene sector conocido; se necesita al menos la mitad.`)
  }
  const bySector = new Map<string, number>()
  for (const h of classified) bySector.set(h.companySector!, (bySector.get(h.companySector!) ?? 0) + h.weight * 100)
  const [topName, topWeight] = [...bySector.entries()].sort((a, b) => b[1] - a[1])[0]
  return {
    id: 'sector',
    name,
    score: gradeLinear(topWeight, 35, 70),
    measured: `El sector con más peso es ${topName}, con ${pct(topWeight, 1)} del portafolio (sector conocido para ${pct(coverage * 100)}).`,
    threshold,
    basis,
  }
}

function geography(input: HealthInput): HealthComponent {
  const name = 'Exposición geográfica'
  const threshold = 'Una región con 65% o menos = 100; 100% en una región = 0.'
  const basis =
    'Referencia: Estados Unidos pesa alrededor de 60–65% del índice global MSCI ACWI, así que no estar más concentrado que el mercado mundial puntúa completo. Los puntos exactos son convención de InvestTracker.'
  const exposure = geographicExposure(
    input.holdings.map((h) => ({ symbol: h.symbol, value: h.weight, sector: null, currency: h.currency ?? 'USD', country: h.country })),
  )
  const top = exposure.buckets[0]
  if (!top || exposure.confidence === 'weak') {
    return unavailable(
      'geography',
      name,
      threshold,
      basis,
      'La región de varias posiciones solo se puede suponer por su moneda, y un fondo en dólares puede invertir en cualquier país.',
    )
  }
  return {
    id: 'geography',
    name,
    score: gradeLinear(top.weightPct, 65, 100),
    measured: `La región con más peso es ${top.name}, con ${pct(top.weightPct, 1)} (${exposure.confidence === 'stated' ? 'según el país de cada empresa' : 'inferida por dónde cotiza cada activo'}).`,
    threshold,
    basis,
  }
}

/** A loading this large on a non-market factor is a pronounced tilt. */
export const STRONG_TILT = 0.5

function factors(input: HealthInput): HealthComponent {
  const name = 'Exposición factorial'
  const threshold = `Sin inclinaciones fuertes (carga de ${STRONG_TILT} o más, estadísticamente significativa) fuera del mercado = 100; cada una resta 34 puntos.`
  const f = input.riskSources.byFactor
  if (!f || f.factors.length < 2) {
    return unavailable('factors', name, threshold, CONVENTION, 'No hay series de factores en el mismo periodo que el portafolio.')
  }
  const tilts = f.factors.filter((x) => x.id !== 'market' && x.significant && Math.abs(x.exposure) >= STRONG_TILT)
  return {
    id: 'factors',
    name,
    score: Math.max(0, 100 - 34 * tilts.length),
    measured:
      tilts.length === 0
        ? `Ninguna inclinación fuerte fuera del mercado; los factores explican ${pct(f.explainedPct)} del riesgo.`
        : `Inclinaciones fuertes: ${tilts.map((x) => `${x.name} (${x.exposure.toFixed(2)})`).join(', ')}.`,
    threshold,
    basis: CONVENTION,
  }
}

function benchmark(input: HealthInput, own: number[]): HealthComponent {
  const name = 'Consistencia con el benchmark'
  const threshold = 'Tracking error anual de 4% o menos = 100; 12% o más = 0.'
  const basis = `Referencia: los fondos que siguen de cerca un índice mantienen tracking errors de pocos puntos y la gestión activa suele moverse entre 4% y 8%. Los puntos exactos son ${CONVENTION_INLINE}`
  const bench = input.benchmarkReturns
  if (!bench || bench.length !== own.length || own.length < 3) {
    return unavailable('benchmark', name, threshold, basis, 'No hay historial del benchmark en el mismo periodo.')
  }
  const active = own.map((r, t) => r - bench[t])
  const te = annualVolatility(active, input.periodsPerYear)
  return {
    id: 'benchmark',
    name,
    score: gradeLinear(te, 4, 12),
    measured: `Tracking error anual de ${pct(te, 1)} frente a ${input.benchmarkName}${input.riskSources.market ? ` (correlación ${input.riskSources.market.correlation.toFixed(2)})` : ''}.`,
    threshold,
    basis,
  }
}

// ─── The score ──────────────────────────────────────────────────────────────

const BANDS: Array<{ min: number; band: HealthBand; label: string }> = [
  { min: 75, band: 'solida', label: 'Sólida' },
  { min: 50, band: 'mejorable', label: 'Mejorable' },
  { min: 0, band: 'fragil', label: 'Frágil' },
]

export function computePortfolioHealth(input: HealthInput): PortfolioHealth | null {
  const n = input.holdings.length
  if (n === 0 || input.returnsMatrix.length !== n) return null
  const T = input.returnsMatrix[0]?.length ?? 0
  if (T < 3 || input.returnsMatrix.some((r) => r.length !== T || !r.every(Number.isFinite))) return null
  if (!input.holdings.every((h) => Number.isFinite(h.weight) && h.weight >= 0)) return null

  const own = portfolioReturns(input)
  const components = [
    diversification(input),
    concentration(input),
    risk(input, own),
    drawdown(input, own),
    liquidity(input),
    sector(input),
    geography(input),
    factors(input),
    benchmark(input, own),
  ]

  const scored = components.filter((c): c is HealthComponent & { score: number } => c.score !== null)
  const score = scored.length >= MIN_COMPONENTS_FOR_SCORE ? Math.round(scored.reduce((s, c) => s + c.score, 0) / scored.length) : null
  const band = score === null ? null : BANDS.find((b) => score >= b.min)!

  return {
    score,
    band: band?.band ?? null,
    bandLabel: band?.label ?? null,
    components,
    componentsScored: scored.length,
    summary: describeHealth(score, scored, components.length),
    caveat: HEALTH_CAVEAT,
  }
}

function describeHealth(score: number | null, scored: Array<HealthComponent & { score: number }>, total: number): string {
  if (score === null) {
    return `Solo ${scored.length} de ${total} componentes tienen datos suficientes; se necesitan ${MIN_COMPONENTS_FOR_SCORE} para un puntaje general.`
  }
  const sorted = [...scored].sort((a, b) => b.score - a.score)
  const strong = sorted.filter((c) => c.score >= 75).slice(0, 2)
  const weak = sorted.filter((c) => c.score < 50).slice(-2).reverse()
  const parts = [`${score} de 100, con ${scored.length} de ${total} componentes medidos.`]
  if (strong.length > 0) parts.push(`Lo más sólido: ${strong.map((c) => `${c.name.toLowerCase()} (${c.score})`).join(' y ')}.`)
  if (weak.length > 0) parts.push(`Lo que más baja el puntaje: ${weak.map((c) => `${c.name.toLowerCase()} (${c.score})`).join(' y ')}.`)
  return parts.join(' ')
}

/**
 * Average daily volume per symbol over its most recent sessions, from stored
 * rows in any order. Sessions with no volume (an index, a provider gap) are
 * skipped rather than averaged in as zero.
 */
export function averageDailyVolumes(
  rows: Array<{ symbol: string; date: string; volume: number | null }>,
  sessions: number,
): Record<string, number> {
  const bySymbol = new Map<string, Array<{ date: string; volume: number }>>()
  for (const row of rows) {
    const volume = Number(row.volume)
    if (!Number.isFinite(volume) || volume <= 0) continue
    const list = bySymbol.get(row.symbol) ?? []
    list.push({ date: row.date, volume })
    bySymbol.set(row.symbol, list)
  }
  const result: Record<string, number> = {}
  for (const [symbol, list] of bySymbol) {
    const recent = list.sort((a, b) => b.date.localeCompare(a.date)).slice(0, sessions)
    result[symbol] = recent.reduce((s, r) => s + r.volume, 0) / recent.length
  }
  return result
}
