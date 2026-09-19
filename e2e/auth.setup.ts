import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { test as setup, expect } from '@playwright/test'
import { AUTH_FILE, BOOK_FILE, E2E_PREFIX, HAS_CREDENTIALS, signIn } from './helpers'

/**
 * Runs once before the signed-in specs: signs in through the real form, keeps
 * the session for every spec (so the suite signs in once, not once per test),
 * and makes sure the account holds the synthetic book the analytics specs read.
 *
 * It refuses to touch an account that looks like a real one. The signed-in
 * specs create and delete portfolios and goals; pointed at a real account by
 * mistake they would do that among somebody's real data. Every portfolio this
 * suite creates is named with E2E_PREFIX, so a portfolio without it means the
 * credentials are not the dedicated test user's.
 */

const BOOK_NAME = `${E2E_PREFIX} · cartera sintética`

/**
 * A small book of liquid US listings with long price histories, bought on one
 * date well in the past so every analytics window has data. Synthetic: the
 * quantities and prices are round numbers, not anyone's positions.
 */
const BOOK = [
  { symbol: 'AAPL', asset_type: 'stock', quantity: 10, price: 150 },
  { symbol: 'MSFT', asset_type: 'stock', quantity: 5, price: 300 },
  { symbol: 'VOO', asset_type: 'etf', quantity: 3, price: 400 },
] as const

const BOUGHT_DAYS_AGO = 400

setup('sign in once and keep the synthetic book', async ({ page }) => {
  setup.skip(!HAS_CREDENTIALS, 'Set E2E_EMAIL and E2E_PASSWORD to run the authenticated flows. See docs/E2E_TESTING.md.')

  await signIn(page)
  mkdirSync(dirname(AUTH_FILE), { recursive: true })
  await page.context().storageState({ path: AUTH_FILE })

  const listed = await page.request.get('/api/portfolio')
  expect(listed.ok(), 'GET /api/portfolio').toBe(true)
  const portfolios: Array<{ id: string; name: string }> = (await listed.json()).data ?? []

  const foreign = portfolios.filter((p) => !p.name.startsWith(E2E_PREFIX))
  if (foreign.length > 0) {
    throw new Error(
      `The E2E account holds ${foreign.length} portfolio(s) not created by this suite. ` +
        'These credentials do not look like the dedicated test user; refusing to create and delete data in them. ' +
        'See docs/E2E_TESTING.md.',
    )
  }

  let book = portfolios.find((p) => p.name === BOOK_NAME)
  if (!book) {
    const created = await page.request.post('/api/portfolio', { data: { name: BOOK_NAME, base_currency: 'USD' } })
    expect(created.status(), 'create the synthetic book').toBe(201)
    book = (await created.json()).data as { id: string; name: string }
  }

  // A book whose purchases failed half-way on an earlier run is completed here
  // rather than left empty, which would make every analytics spec vacuous.
  const detail = await page.request.get(`/api/portfolio/${book.id}`)
  expect(detail.ok(), 'read the synthetic book').toBe(true)
  const held = new Set<string>(((await detail.json()).data?.positions ?? []).map((p: { symbol: string }) => p.symbol))
  const executedAt = new Date(Date.now() - BOUGHT_DAYS_AGO * 86_400_000).toISOString()
  for (const holding of BOOK.filter((h) => !held.has(h.symbol))) {
    const bought = await page.request.post('/api/transaction', {
      data: { portfolio_id: book.id, ...holding, type: 'buy', fees: 0, currency: 'USD', executed_at: executedAt },
    })
    expect(bought.ok(), `buy ${holding.symbol} in the synthetic book`).toBe(true)
  }

  writeFileSync(BOOK_FILE, JSON.stringify({ portfolioId: book.id }))
})
