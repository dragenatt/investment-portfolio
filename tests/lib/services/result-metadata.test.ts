import { describe, it, expect, vi, beforeEach } from 'vitest'

const store = new Map<string, unknown>()
vi.mock('@/lib/cache/redis', () => ({
  cacheGet: vi.fn(async (key: string) => (store.has(key) ? structuredClone(store.get(key)) : null)),
  cacheSet: vi.fn(async (key: string, value: unknown) => void store.set(key, structuredClone(value))),
}))

import {
  buildResultMetadata,
  combinePriceSources,
  describeMetadata,
  markServed,
  MODEL_VERSIONS,
  withMetadata,
} from '@/lib/services/result-metadata'
import { withAuditedCache } from '@/lib/cache/with-cache'
import { SCENARIO_ENGINE_VERSION } from '@/lib/services/scenario-engine'
import { ADVISOR_MODEL_VERSION } from '@/lib/services/advisor'

const now = new Date('2026-09-15T18:30:00Z')

function sample() {
  return buildResultMetadata({
    model: 'risk',
    data: { description: 'Valor diario del portafolio', symbols: ['AAA', 'BBB'], excluded: ['CCC'], priceSource: 'mixed' },
    period: { from: '2026-03-12', to: '2026-09-14', observations: 124, cadence: '1 dia' },
    assumptions: [
      { name: 'Días por año', value: '252', source: 'Convención' },
      { name: 'Sin fuente', value: 'x', source: '  ' },
    ],
    benchmark: { symbol: 'SPY', name: 'S&P 500' },
    riskFreeRate: { currency: 'MXN', rate: 0.06789, source: 'banxico:cetes28', asOf: '2026-09-11', isFallback: false },
    now,
  })
}

describe('buildResultMetadata', () => {
  it('answers each of the eight questions in its own field', () => {
    const meta = sample()
    expect(meta).toEqual({
      model: { id: 'risk', version: MODEL_VERSIONS.risk },
      computedAt: '2026-09-15T18:30:00.000Z',
      data: { description: 'Valor diario del portafolio', symbols: ['AAA', 'BBB'], excluded: ['CCC'], priceSource: 'mixed' },
      period: { from: '2026-03-12', to: '2026-09-14', observations: 124, cadence: '1 dia' },
      // An assumption without a source is not an assumption anyone can check.
      assumptions: [{ name: 'Días por año', value: '252', source: 'Convención' }],
      benchmark: { symbol: 'SPY', name: 'S&P 500' },
      riskFreeRate: { currency: 'MXN', annualPct: 6.79, source: 'banxico:cetes28', asOf: '2026-09-11', isFallback: false },
      cache: { served: 'computed', ttlSeconds: null },
    })
  })

  it('says explicitly when a field does not apply', () => {
    const meta = buildResultMetadata({ model: 'income', data: { description: 'Dividendos', symbols: [], priceSource: 'none' } })
    expect(meta.benchmark).toBeNull()
    expect(meta.riskFreeRate).toBeNull()
    expect(meta.period).toEqual({ from: null, to: null, observations: null, cadence: null })
  })

  it('ties versioned models to the versions their engines publish', () => {
    expect(MODEL_VERSIONS.scenarioEngine).toBe(SCENARIO_ENGINE_VERSION)
    expect(MODEL_VERSIONS.advisor).toBe(ADVISOR_MODEL_VERSION)
    expect(MODEL_VERSIONS.factors).toBe('etf-proxy-v1')
  })
})

describe('combinePriceSources', () => {
  it('reports one tier when every read agrees, mixed when they do not, and ignores absent reads', () => {
    expect(combinePriceSources('stored', 'stored', null)).toBe('stored')
    expect(combinePriceSources('stored', 'provider')).toBe('mixed')
    expect(combinePriceSources('none', undefined)).toBe('none')
    expect(combinePriceSources('provider', 'none')).toBe('provider')
  })
})

describe('markServed and withMetadata', () => {
  it('marks only results that carry metadata', () => {
    const result = withMetadata({ value: 1 }, sample())
    expect(markServed(result, 'cache', 600)._meta.cache).toEqual({ served: 'cache', ttlSeconds: 600 })
    expect(result._meta.cache.served).toBe('computed') // not mutated
    expect(markServed(null, 'cache', 1)).toBeNull()
    expect(markServed([1, 2], 'cache', 1)).toEqual([1, 2])
    expect(markServed({ plain: true }, 'cache', 1)).toEqual({ plain: true })
  })
})

describe('withAuditedCache', () => {
  beforeEach(() => store.clear())

  it('says a fresh result was computed, and a stored one came from the cache with its original computedAt', async () => {
    const compute = vi.fn(async () => withMetadata({ value: 42 }, sample()))
    const first = await withAuditedCache('k', 900, compute)
    const second = await withAuditedCache('k', 900, compute)

    expect(compute).toHaveBeenCalledTimes(1)
    expect(first._meta.cache).toEqual({ served: 'computed', ttlSeconds: 900 })
    expect(second._meta.cache).toEqual({ served: 'cache', ttlSeconds: 900 })
    expect(second._meta.computedAt).toBe(first._meta.computedAt)
    expect(second.value).toBe(42)
  })
})

describe('describeMetadata', () => {
  it('answers the eight questions in Spanish, in order', () => {
    const answers = describeMetadata(markServed({ _meta: sample() }, 'cache', 1800)._meta)
    expect(answers.map((a) => a.question)).toEqual([
      '¿Qué datos utilizó?',
      '¿Qué periodo utilizó?',
      '¿Qué supuestos utilizó?',
      '¿Qué versión del modelo utilizó?',
      '¿Qué benchmark utilizó?',
      '¿Qué tasa libre de riesgo utilizó?',
      '¿Cuándo se calculó?',
      '¿Se utilizaron datos reales o cacheados?',
    ])
    const text = Object.fromEntries(answers.map((a) => [a.question, a.answer]))
    expect(text['¿Qué datos utilizó?']).toContain('Excluidos por falta de datos: CCC')
    expect(text['¿Qué periodo utilizó?']).toBe('Del 2026-03-12 al 2026-09-14, 124 observaciones (1 dia).')
    expect(text['¿Qué benchmark utilizó?']).toBe('S&P 500 (SPY).')
    expect(text['¿Qué tasa libre de riesgo utilizó?']).toContain('6.79% anual en MXN')
    expect(text['¿Cuándo se calculó?']).toContain('2026')
    expect(text['¿Se utilizaron datos reales o cacheados?']).toBe(
      'Historial guardado completado con consultas al proveedor. El resultado se sirvió desde caché (se recalcula cada 30 minutos).',
    )
  })

  it('says when there is no benchmark or risk-free rate rather than leaving it blank', () => {
    const answers = describeMetadata(buildResultMetadata({ model: 'allocation', data: { description: 'Posiciones', symbols: ['A'], priceSource: 'stored' } }))
    const text = Object.fromEntries(answers.map((a) => [a.question, a.answer]))
    expect(text['¿Qué benchmark utilizó?']).toContain('Ninguno')
    expect(text['¿Qué tasa libre de riesgo utilizó?']).toContain('Ninguna')
    expect(text['¿Qué periodo utilizó?']).toContain('posición actual')
  })
})
