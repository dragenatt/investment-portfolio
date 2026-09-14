// Feature flags — pure resolution, read once from the environment.
//
// The point is not toggling for its own sake. Several of the engines in this
// codebase are new, expensive, or both — a Monte Carlo over a large book, a
// walk-forward backtest, an optimiser — and being able to turn one off without
// a deploy is what makes shipping them safe.
//
// Every flag defaults to a deliberate value below, and the default is what runs
// unless an environment variable says otherwise. A flag with no default is a
// flag whose behaviour nobody can predict.

export type FeatureFlag =
  | 'monteCarlo'
  | 'backtesting'
  | 'walkForward'
  | 'riskAttribution'
  | 'drawdownAnalysis'
  | 'tailRisk'
  | 'rebalancing'
  | 'exposure'
  | 'advisor'
  | 'advisorSensitivity'
  | 'dataQuality'
  | 'auditTrail'
  | 'notifications'
  | 'markowitz'
  | 'cvarOptimisation'
  | 'riskParity'
  | 'factorModel'
  | 'financialLab'
  | 'streaming'
  | 'pwa'

/**
 * What each flag does when nothing overrides it.
 *
 * Anything already shipped and exercised defaults on. Anything whose backing
 * engine is not written yet defaults off, so a half-built feature cannot reach a
 * user because someone forgot to gate it.
 */
const DEFAULTS: Record<FeatureFlag, boolean> = {
  monteCarlo: true,
  backtesting: true,
  walkForward: true,
  riskAttribution: true,
  drawdownAnalysis: true,
  tailRisk: true,
  rebalancing: true,
  exposure: true,
  advisor: true,
  advisorSensitivity: true,
  dataQuality: true,
  // Migration 013 landed in 9cd1bfa, so audit_log and notifications exist.
  auditTrail: true,
  notifications: true,
  // Shipped in OLA 3–4 (P1-26 factors, P1-31 Markowitz, P1-32 CVaR and risk
  // parity) and OLA 6 (E1 lab). These stayed false under a "not implemented
  // yet" comment for two waves after the engines landed; the lab's Markowitz
  // experiment read the flag and hid itself in production as a result.
  markowitz: true,
  cvarOptimisation: true,
  riskParity: true,
  factorModel: true,
  financialLab: true,
  // Shipped in OLA 7 (C2): prices streamed over Supabase Realtime.
  streaming: true,
  // Not implemented yet.
  pwa: false,
}

/** `FEATURE_MONTE_CARLO`, `FEATURE_WALK_FORWARD`, and so on. */
function envKey(flag: FeatureFlag): string {
  return 'FEATURE_' + flag.replace(/[A-Z]/g, (c) => '_' + c).toUpperCase()
}

/**
 * Parse an environment value into a decision.
 *
 * Anything unrecognised returns null rather than false: a typo in
 * `FEATURE_BACKTESTING=treu` should fall back to the documented default, not
 * silently disable a working feature.
 */
function parse(raw: string | undefined): boolean | null {
  if (raw === undefined) return null
  const value = raw.trim().toLowerCase()
  if (['1', 'true', 'on', 'yes', 'enabled'].includes(value)) return true
  if (['0', 'false', 'off', 'no', 'disabled'].includes(value)) return false
  return null
}

export function isEnabled(flag: FeatureFlag): boolean {
  return parse(process.env[envKey(flag)]) ?? DEFAULTS[flag]
}

export type FlagState = {
  flag: FeatureFlag
  enabled: boolean
  default: boolean
  /** Whether an environment variable is actually overriding the default. */
  overridden: boolean
  envKey: string
}

/** Every flag with its current state — for /admin/metrics and for debugging. */
export function allFlags(): FlagState[] {
  return (Object.keys(DEFAULTS) as FeatureFlag[]).map((flag) => {
    const override = parse(process.env[envKey(flag)])
    return {
      flag,
      enabled: override ?? DEFAULTS[flag],
      default: DEFAULTS[flag],
      overridden: override !== null,
      envKey: envKey(flag),
    }
  })
}

/** The subset safe to hand a browser: names and whether they are on. */
export function publicFlags(): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  for (const state of allFlags()) out[state.flag] = state.enabled
  return out
}
