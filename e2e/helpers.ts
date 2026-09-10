import { test as base, expect, type Page } from '@playwright/test'

/**
 * Credentials for the signed-in suite.
 *
 * Absent by default. Everything that needs them skips loudly rather than
 * passing vacuously — see `authTest` below.
 */
export const E2E_EMAIL = process.env.E2E_EMAIL
export const E2E_PASSWORD = process.env.E2E_PASSWORD
export const HAS_CREDENTIALS = Boolean(E2E_EMAIL && E2E_PASSWORD)

/**
 * A page that fails the test if the browser console reports an error.
 *
 * This is the cheapest broad safety net there is: a React hydration mismatch, a
 * failed fetch or a thrown handler shows up here without anyone having to write
 * a specific assertion for it.
 */
export const test = base.extend<{ page: Page }>({
  page: async ({ page }, use, testInfo) => {
    const errors: string[] = []

    page.on('console', (message) => {
      if (message.type() !== 'error') return
      const text = message.text()
      // Third-party noise the app does not control and cannot fix.
      if (/favicon|Failed to load resource.*40[34]|ResizeObserver/i.test(text)) return
      errors.push(text)
    })

    page.on('pageerror', (err) => errors.push(`Uncaught: ${err.message}`))

    await use(page)

    if (errors.length > 0 && testInfo.status === 'passed') {
      throw new Error(`Console errors on this page:\n  ${errors.join('\n  ')}`)
    }
  },
})

export { expect }

/**
 * Assert no financial figure rendered as NaN, Infinity or undefined.
 *
 * Roadmap item 14 of P1-3 asks for exactly this, and it is worth a dedicated
 * check: these never throw, they just render, and a reader who sees "NaN%" once
 * stops trusting every other number on the page.
 */
export async function expectNoBrokenNumbers(page: Page) {
  const body = await page.locator('body').innerText()
  expect(body, 'a value rendered as NaN').not.toMatch(/\bNaN\b/)
  expect(body, 'a value rendered as Infinity').not.toMatch(/\bInfinity\b/)
  expect(body, 'a value rendered as undefined').not.toMatch(/\bundefined\b/)
  expect(body, 'a value rendered as [object Object]').not.toContain('[object Object]')
}

/** Sign in through the real form, so the test exercises the same path a user does. */
export async function signIn(page: Page) {
  await page.goto('/login')
  await page.getByLabel(/email|correo/i).fill(E2E_EMAIL!)
  await page.getByLabel(/password|contrase/i).fill(E2E_PASSWORD!)
  await page.getByRole('button', { name: /iniciar|entrar|sign in|log in/i }).click()
  await page.waitForURL(/dashboard|portfolio/, { timeout: 30_000 })
}
