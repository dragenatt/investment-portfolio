import { describe, it, expect } from 'vitest'
import {
  parseTreasuryBillsRate,
  parseEcbEstrRate,
  parseOecdShortTermRate,
  parseBanxicoCetesRate,
  resolveRiskFreeRate,
  type RateProvider,
} from '@/lib/services/risk-free-rate'
import treasuryFixture from '../../fixtures/us-treasury-bills.json'
import ecbFixture from '../../fixtures/ecb-estr.json'
import oecdFixture from '../../fixtures/oecd-mex-3m.json'

describe('parseTreasuryBillsRate', () => {
  it('reads the published Treasury Bills rate as a fraction', () => {
    // Live response captured 2026-09-08: 3.788% as of 2026-08-31
    expect(parseTreasuryBillsRate(treasuryFixture)).toEqual({
      rate: 0.03788,
      asOf: '2026-08-31',
    })
  })

  it('returns null for a response with no rows', () => {
    expect(parseTreasuryBillsRate({ data: [] })).toBeNull()
  })

  it('returns null for an unrecognised payload', () => {
    expect(parseTreasuryBillsRate(null)).toBeNull()
    expect(parseTreasuryBillsRate({})).toBeNull()
    expect(parseTreasuryBillsRate({ data: [{ avg_interest_rate_amt: 'n/a' }] })).toBeNull()
  })
})

describe('parseEcbEstrRate', () => {
  it('reads the €STR observation and its date', () => {
    // Live response captured 2026-09-08: 2.188% as of 2026-09-07
    expect(parseEcbEstrRate(ecbFixture)).toEqual({ rate: 0.02188, asOf: '2026-09-07' })
  })

  it('returns null when the series carries no observation', () => {
    expect(parseEcbEstrRate({ dataSets: [{ series: {} }] })).toBeNull()
    expect(parseEcbEstrRate(undefined)).toBeNull()
  })
})

describe('parseOecdShortTermRate', () => {
  it('reads the Mexican 3-month interbank rate and its period', () => {
    // Live response captured 2026-09-08: 6.79% for 2026-08
    expect(parseOecdShortTermRate(oecdFixture)).toEqual({ rate: 0.0679, asOf: '2026-08' })
  })

  it('returns null for an empty result set', () => {
    expect(parseOecdShortTermRate({ data: { dataSets: [] } })).toBeNull()
  })
})

describe('parseBanxicoCetesRate', () => {
  const sie = (dato: string) => ({
    bmx: { series: [{ idSerie: 'SF43936', datos: [{ fecha: '05/09/2026', dato }] }] },
  })

  it('reads the CETES 28-day rate and converts the date to ISO', () => {
    expect(parseBanxicoCetesRate(sie('7.45'))).toEqual({ rate: 0.0745, asOf: '2026-09-05' })
  })

  it('returns null when Banxico reports no value', () => {
    // SIE publishes "N/E" (no existe) for periods without a quote
    expect(parseBanxicoCetesRate(sie('N/E'))).toBeNull()
  })

  it('returns null for an implausible rate', () => {
    expect(parseBanxicoCetesRate(sie('120'))).toBeNull()
  })
})

describe('resolveRiskFreeRate', () => {
  const provider = (id: string, reading: { rate: number; asOf: string | null } | null): RateProvider => ({
    id,
    load: async () => reading,
  })
  const failing = (id: string): RateProvider => ({
    id,
    load: async () => {
      throw new Error('provider down')
    },
  })
  const DEFAULT = { rate: 0.04, source: 'documented-default' }

  it('takes the first provider that answers', async () => {
    const result = await resolveRiskFreeRate(
      'USD',
      [provider('primary', { rate: 0.038, asOf: '2026-08-31' }), provider('secondary', { rate: 0.05, asOf: null })],
      null,
      DEFAULT,
    )
    expect(result).toEqual({
      currency: 'USD',
      rate: 0.038,
      source: 'primary',
      asOf: '2026-08-31',
      isFallback: false,
    })
  })

  it('moves to the next provider when one throws', async () => {
    const result = await resolveRiskFreeRate(
      'MXN',
      [failing('banxico'), provider('oecd', { rate: 0.0679, asOf: '2026-08' })],
      null,
      DEFAULT,
    )
    expect(result.rate).toBe(0.0679)
    expect(result.source).toBe('oecd')
    expect(result.isFallback).toBe(false)
  })

  it('moves on when a provider answers with nothing', async () => {
    const result = await resolveRiskFreeRate(
      'EUR',
      [provider('ecb', null), provider('oecd', { rate: 0.022, asOf: '2026-08' })],
      null,
      DEFAULT,
    )
    expect(result.source).toBe('oecd')
  })

  it('falls back to the configured environment rate', async () => {
    const result = await resolveRiskFreeRate('MXN', [failing('banxico')], 0.0745, DEFAULT)
    expect(result).toEqual({
      currency: 'MXN',
      rate: 0.0745,
      source: 'env',
      asOf: null,
      isFallback: true,
    })
  })

  it('falls back to the documented default when nothing else answers', async () => {
    const result = await resolveRiskFreeRate('USD', [failing('treasury')], null, DEFAULT)
    expect(result).toEqual({
      currency: 'USD',
      rate: 0.04,
      source: 'documented-default',
      asOf: null,
      isFallback: true,
    })
  })

  it('rejects a provider reading outside the plausible band', async () => {
    const result = await resolveRiskFreeRate('USD', [provider('broken', { rate: 3, asOf: null })], null, DEFAULT)
    expect(result.source).toBe('documented-default')
    expect(result.isFallback).toBe(true)
  })
})
