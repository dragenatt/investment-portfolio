import { describe, it, expect, afterEach } from 'vitest'
import { isEnabled, allFlags, publicFlags } from '@/lib/services/feature-flags'

const touched: string[] = []
const setEnv = (key: string, value: string | undefined) => {
  touched.push(key)
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}

afterEach(() => {
  for (const key of touched) delete process.env[key]
  touched.length = 0
})

describe('isEnabled', () => {
  it('uses the documented default when nothing is set', () => {
    expect(isEnabled('backtesting')).toBe(true)
    expect(isEnabled('markowitz')).toBe(false)
  })

  it('lets the environment turn a feature off', () => {
    setEnv('FEATURE_BACKTESTING', 'false')
    expect(isEnabled('backtesting')).toBe(false)
  })

  it('lets the environment turn a feature on', () => {
    setEnv('FEATURE_MARKOWITZ', 'true')
    expect(isEnabled('markowitz')).toBe(true)
  })

  it('accepts the spellings an operator actually types', () => {
    for (const value of ['1', 'true', 'on', 'yes', 'ENABLED', ' True ']) {
      setEnv('FEATURE_MARKOWITZ', value)
      expect(isEnabled('markowitz')).toBe(true)
    }
    for (const value of ['0', 'false', 'off', 'no', 'DISABLED']) {
      setEnv('FEATURE_BACKTESTING', value)
      expect(isEnabled('backtesting')).toBe(false)
    }
  })

  it('falls back to the default on a typo rather than silently disabling', () => {
    // FEATURE_BACKTESTING=treu must not turn off a working feature
    setEnv('FEATURE_BACKTESTING', 'treu')
    expect(isEnabled('backtesting')).toBe(true)
  })

  it('builds the environment key from the flag name', () => {
    const state = allFlags().find((f) => f.flag === 'walkForward')!
    expect(state.envKey).toBe('FEATURE_WALK_FORWARD')
  })
})

describe('allFlags', () => {
  it('reports every flag with its default', () => {
    const flags = allFlags()
    expect(flags.length).toBeGreaterThan(10)
    expect(flags.every((f) => typeof f.default === 'boolean')).toBe(true)
  })

  it('marks which flags are actually overridden', () => {
    setEnv('FEATURE_MARKOWITZ', 'true')
    const flags = allFlags()
    expect(flags.find((f) => f.flag === 'markowitz')!.overridden).toBe(true)
    expect(flags.find((f) => f.flag === 'backtesting')!.overridden).toBe(false)
  })

  it('keeps unimplemented engines off by default', () => {
    // A half-built feature must not reach a user because someone forgot to gate it
    const off = allFlags().filter((f) => !f.default).map((f) => f.flag)
    expect(off).toContain('markowitz')
    expect(off).toContain('factorModel')
    expect(off).toContain('riskParity')
  })

  it('has the audit trail and notifications on now that migration 013 is applied', () => {
    const flags = allFlags()
    expect(flags.find((f) => f.flag === 'auditTrail')!.default).toBe(true)
    expect(flags.find((f) => f.flag === 'notifications')!.default).toBe(true)
  })
})

describe('publicFlags', () => {
  it('is a flat name-to-boolean map', () => {
    const flags = publicFlags()
    expect(typeof flags.backtesting).toBe('boolean')
    expect(Object.values(flags).every((v) => typeof v === 'boolean')).toBe(true)
  })
})
