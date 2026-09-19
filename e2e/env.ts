import { readFileSync } from 'node:fs'

/**
 * What the signed-in suite needs from its environment, kept apart from the test
 * fixtures so playwright.config.ts can read it without loading them.
 *
 * Credentials are absent by default. Everything that needs them skips loudly
 * rather than passing vacuously.
 */
export const E2E_EMAIL = process.env.E2E_EMAIL
export const E2E_PASSWORD = process.env.E2E_PASSWORD
export const HAS_CREDENTIALS = Boolean(E2E_EMAIL && E2E_PASSWORD)

/** The signed-in session, written by auth.setup.ts and loaded by every signed-in spec. */
export const AUTH_FILE = 'e2e/.auth/user.json'
/** The synthetic book auth.setup.ts keeps in the test account. */
export const BOOK_FILE = 'e2e/.auth/book.json'
/** Every portfolio and goal the suite creates is named with this. */
export const E2E_PREFIX = 'E2E'

/**
 * The portfolio the analytics specs read: E2E_PORTFOLIO_ID when set, otherwise
 * the synthetic book the setup project keeps. Null before the setup has run.
 */
export function bookPortfolioId(): string | null {
  if (process.env.E2E_PORTFOLIO_ID) return process.env.E2E_PORTFOLIO_ID
  try {
    return (JSON.parse(readFileSync(BOOK_FILE, 'utf8')) as { portfolioId?: string }).portfolioId ?? null
  } catch {
    return null
  }
}
