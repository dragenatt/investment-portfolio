// Financial constants with exactly one definition each.
//
// These are not derived from anything and not configurable at runtime: they are
// conventions, and the register in docs/FINANCIAL_ASSUMPTIONS.md is where their
// justification lives. What they are NOT is per-module — which is what they had
// become. `252` was declared seventeen times under src/lib and written as a
// literal twice more inside analytics.ts, which already held its own copy of the
// constant four lines further down.
//
// Every copy held the same value, so nothing was wrong numerically. The cost was
// latent: P0-20 asks for the assumptions to be centralised precisely so that
// changing one is one edit, and so that a reader can find out what the system
// assumes without grepping. Seventeen copies is seventeen places to miss.

/**
 * Trading days in a year: roughly 365 less weekends and holidays.
 *
 * The convention used to annualise everything daily in this codebase — daily
 * volatility by √252 and daily mean return by ×252. Mixing conventions is the
 * real hazard: a Sharpe annualised on 252 and a volatility annualised on 250 are
 * not comparable, and the difference is invisible in the output.
 *
 * Registered in docs/FINANCIAL_ASSUMPTIONS.md ("Trading days per year").
 */
export const TRADING_DAYS_PER_YEAR = 252
