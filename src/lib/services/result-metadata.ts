// Result metadata (P2-10) — pure functions, no I/O.
//
// Every important financial result answers eight questions about itself:
//
//   1. What data did it use?          data
//   2. What period?                   period
//   3. What assumptions?              assumptions
//   4. Which model version?           model
//   5. Which benchmark?               benchmark
//   6. Which risk-free rate?          riskFreeRate
//   7. When was it computed?          computedAt
//   8. Real or cached data?           data.priceSource (the market data) and
//                                     cache (the result itself)
//
// The structure travels with the result as `_meta`. A field that does not
// apply is null and says so, rather than being left out: "no benchmark was
// used" and "we forgot to record the benchmark" must not look the same.

import { ADVISOR_MODEL_VERSION } from './advisor'
import { CONSTRUCTION_VERSION } from './factors'
import { SCENARIO_ENGINE_VERSION } from './scenario-engine'
import { TRADING_DAYS_PER_YEAR } from '@/lib/constants/financial-constants'

/**
 * The version of each model behind a result. Bump a model's version when a
 * change moves its numbers, so a result can be matched to the code that made it.
 */
export const MODEL_VERSIONS = {
  risk: '1.0.0',
  returns: '1.0.0',
  attribution: '1.0.0',
  temporalAttribution: '1.0.0',
  allocation: '1.0.0',
  exposure: '1.0.0',
  income: '1.0.0',
  performance: '1.0.0',
  benchmark: '1.0.0',
  riskSources: '1.0.0',
  portfolioHealth: '1.0.0',
  diagnostic: '1.0.0',
  scenarioComparison: '1.0.0',
  scenarioEngine: SCENARIO_ENGINE_VERSION,
  optimization: '1.0.0',
  factors: CONSTRUCTION_VERSION,
  monteCarlo: '1.0.0',
  // 2.0.0 (4.9): replayed through the scenario engine; a rebalance pays the
  // trade cost on every trade, both the sale and the purchase.
  backtest: '2.0.0',
  stress: '1.0.0',
  rebalance: '1.0.0',
  advisor: ADVISOR_MODEL_VERSION,
} as const

export type ResultModel = keyof typeof MODEL_VERSIONS

/** Where market data came from: the stored history, a live provider call, both, or no market data at all. */
export type PriceSource = 'stored' | 'provider' | 'mixed' | 'none'

export type ResultAssumption = {
  name: string
  value: string
  /** A citation, a register entry, or "convención" — never empty. */
  source: string
}

export type ResultMetadata = {
  model: { id: ResultModel; version: string }
  computedAt: string
  data: {
    /** What was read, in words: "precios de cierre diarios de 6 posiciones". */
    description: string
    symbols: string[]
    /** Holdings left out, and why the caller could not use them. */
    excluded: string[]
    priceSource: PriceSource
  }
  period: {
    from: string | null
    to: string | null
    observations: number | null
    cadence: string | null
  }
  assumptions: ResultAssumption[]
  benchmark: { symbol: string; name: string } | null
  riskFreeRate: { currency: string; annualPct: number; source: string; asOf: string | null; isFallback: boolean } | null
  cache: { served: 'computed' | 'cache'; ttlSeconds: number | null }
}

export type MetadataInput = Omit<ResultMetadata, 'model' | 'computedAt' | 'cache' | 'data' | 'period' | 'assumptions' | 'benchmark' | 'riskFreeRate'> & {
  model: ResultModel
  data: Omit<ResultMetadata['data'], 'excluded'> & { excluded?: string[] }
  period?: Partial<ResultMetadata['period']>
  assumptions?: ResultAssumption[]
  benchmark?: ResultMetadata['benchmark']
  riskFreeRate?: { currency: string; rate: number; source: string; asOf?: string | null; isFallback: boolean } | null
  now?: Date
}

/** The assumptions most results share, stated once. */
export const COMMON_ASSUMPTIONS = {
  tradingDays: { name: 'Días de negociación por año', value: String(TRADING_DAYS_PER_YEAR), source: 'Convención de mercado (docs/FINANCIAL_ASSUMPTIONS.md)' },
  priceReturn: {
    name: 'Tipo de rendimiento',
    value: 'Rendimiento de precio, sin dividendos',
    source: 'Límite de los datos: el historial no distingue dividendos (docs/DATA_QUALITY.md)',
  },
  splitAdjusted: { name: 'Precios', value: 'Ajustados por splits', source: 'corporate-actions.ts' },
  currentWeights: { name: 'Pesos', value: 'Los actuales, constantes en todo el periodo', source: 'Convención del cálculo' },
  gross: { name: 'Costos', value: 'No incluidos: cifras brutas', source: 'costs.ts (nunca se inventan costos)' },
} satisfies Record<string, ResultAssumption>

/**
 * Build the metadata for a result computed now.
 *
 * `cache` starts as "computed"; the cache wrapper marks a result it served
 * from storage, keeping the original computedAt.
 */
export function buildResultMetadata(input: MetadataInput): ResultMetadata {
  const rf = input.riskFreeRate ?? null
  return {
    model: { id: input.model, version: MODEL_VERSIONS[input.model] },
    computedAt: (input.now ?? new Date()).toISOString(),
    data: {
      description: input.data.description,
      symbols: [...input.data.symbols],
      excluded: [...(input.data.excluded ?? [])],
      priceSource: input.data.priceSource,
    },
    period: {
      from: input.period?.from ?? null,
      to: input.period?.to ?? null,
      observations: input.period?.observations ?? null,
      cadence: input.period?.cadence ?? null,
    },
    assumptions: (input.assumptions ?? []).filter((a) => a.source.trim().length > 0),
    benchmark: input.benchmark ?? null,
    riskFreeRate: rf
      ? {
          currency: rf.currency,
          annualPct: Math.round(rf.rate * 10000) / 100,
          source: rf.source,
          asOf: rf.asOf ?? null,
          isFallback: rf.isFallback,
        }
      : null,
    cache: { served: 'computed', ttlSeconds: null },
  }
}

/** Combine the tiers of several price reads into one answer. */
export function combinePriceSources(...sources: Array<PriceSource | null | undefined>): PriceSource {
  const used = [...new Set(sources.filter((s): s is PriceSource => !!s && s !== 'none'))]
  if (used.length === 0) return 'none'
  if (used.length === 1) return used[0]
  return 'mixed'
}

/** Attach metadata to an object result. Arrays and nulls are wrapped rather than mutated. */
export function withMetadata<T extends object>(result: T, meta: ResultMetadata): T & { _meta: ResultMetadata } {
  return { ...result, _meta: meta }
}

/**
 * Mark how a result was served. Called by the cache wrapper on the way out:
 * a stored result keeps the moment it was computed and says it came from cache.
 */
export function markServed<T>(result: T, served: 'computed' | 'cache', ttlSeconds: number | null): T {
  if (!result || typeof result !== 'object' || Array.isArray(result) || !('_meta' in result)) return result
  const meta = (result as { _meta: ResultMetadata })._meta
  if (!meta || typeof meta !== 'object') return result
  return { ...result, _meta: { ...meta, cache: { served, ttlSeconds } } }
}

const PRICE_SOURCE_LABELS: Record<PriceSource, string> = {
  stored: 'Historial de precios guardado',
  provider: 'Consulta en vivo al proveedor de mercado',
  mixed: 'Historial guardado completado con consultas al proveedor',
  none: 'Sin datos de mercado',
}

/** The eight questions answered in Spanish, for the interface. */
export function describeMetadata(meta: ResultMetadata): Array<{ question: string; answer: string }> {
  const period =
    meta.period.from && meta.period.to
      ? `Del ${meta.period.from} al ${meta.period.to}` +
        (meta.period.observations !== null ? `, ${meta.period.observations} observaciones` : '') +
        (meta.period.cadence ? ` (${meta.period.cadence})` : '') +
        '.'
      : 'No depende de un periodo de historial: usa la posición actual.'
  return [
    {
      question: '¿Qué datos utilizó?',
      answer:
        `${meta.data.description}.` +
        (meta.data.symbols.length > 0 ? ` Activos: ${meta.data.symbols.join(', ')}.` : '') +
        (meta.data.excluded.length > 0 ? ` Excluidos por falta de datos: ${meta.data.excluded.join(', ')}.` : ''),
    },
    { question: '¿Qué periodo utilizó?', answer: period },
    {
      question: '¿Qué supuestos utilizó?',
      answer: meta.assumptions.length > 0 ? meta.assumptions.map((a) => `${a.name}: ${a.value} (${a.source})`).join('; ') + '.' : 'Ninguno más allá de los datos.',
    },
    { question: '¿Qué versión del modelo utilizó?', answer: `${meta.model.id} ${meta.model.version}.` },
    { question: '¿Qué benchmark utilizó?', answer: meta.benchmark ? `${meta.benchmark.name} (${meta.benchmark.symbol}).` : 'Ninguno: este resultado no se compara con un índice.' },
    {
      question: '¿Qué tasa libre de riesgo utilizó?',
      answer: meta.riskFreeRate
        ? `${meta.riskFreeRate.annualPct.toFixed(2)}% anual en ${meta.riskFreeRate.currency}, fuente ${meta.riskFreeRate.source}` +
          (meta.riskFreeRate.asOf ? ` al ${meta.riskFreeRate.asOf}` : '') +
          (meta.riskFreeRate.isFallback ? ' (valor de respaldo documentado: el proveedor no respondió)' : '') +
          '.'
        : 'Ninguna: este resultado no la necesita.',
    },
    { question: '¿Cuándo se calculó?', answer: new Date(meta.computedAt).toLocaleString('es-MX', { dateStyle: 'long', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC.' },
    {
      question: '¿Se utilizaron datos reales o cacheados?',
      answer:
        `${PRICE_SOURCE_LABELS[meta.data.priceSource]}. ` +
        (meta.cache.served === 'cache'
          ? `El resultado se sirvió desde caché (se recalcula cada ${Math.round((meta.cache.ttlSeconds ?? 0) / 60)} minutos).`
          : 'El resultado se calculó en esta consulta.'),
    },
  ]
}
