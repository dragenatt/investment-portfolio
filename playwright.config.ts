import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end configuration.
 *
 * The suite is split in two by design. `public` covers everything reachable
 * without signing in and runs anywhere, including CI with no secrets. `auth`
 * covers the signed-in flows and is SKIPPED unless E2E_EMAIL and E2E_PASSWORD
 * are present — a suite that silently passes because it never ran is worse than
 * no suite, so the skip is explicit and visible in the report.
 *
 * Run: npm run test:e2e
 */
const PORT = Number(process.env.E2E_PORT ?? 3100)
const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`

export default defineConfig({
  testDir: './e2e',
  // The financial flows are slow: a Monte Carlo over a real book is not instant.
  timeout: 60_000,
  expect: { timeout: 10_000 },

  // Serial locally so a single browser is enough; CI parallelises.
  fullyParallel: !!process.env.CI,
  workers: process.env.CI ? 2 : 1,

  // A test that only passes on the second attempt is a flaky test, and in CI
  // that is worth knowing about rather than papering over.
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,

  reporter: process.env.CI ? [['github'], ['list']] : [['list']],

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],

  // Reuses an already-running server locally; starts one in CI.
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `npx next dev --port ${PORT}`,
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
})
