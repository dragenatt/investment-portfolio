import type { Page } from '@playwright/test'
import { test, expect, expectNoBrokenNumbers, bookPortfolioId, E2E_PREFIX, HAS_CREDENTIALS } from './helpers'

/**
 * The signed-in flows the roadmap lists.
 *
 * Skipped entirely without E2E_EMAIL and E2E_PASSWORD. The skip is deliberate
 * and visible: a suite that passes because it never ran is worse than no suite,
 * since it reports confidence nobody has earned.
 *
 * The session comes from auth.setup.ts, which signs in once and refuses an
 * account that looks like a real one. Anything a spec creates is named with
 * E2E_PREFIX and deleted by the same spec.
 */

const SKIP_REASON = 'Set E2E_EMAIL and E2E_PASSWORD to run the authenticated flows. See docs/E2E_TESTING.md.'

/** The advisor's fixed draw (ADVISOR_SEED): every run reports it. */
const ADVISOR_SEED = '20260912'

/** Answer the advisor's four steps with a synthetic plan and ask for the analysis. */
async function completeAdvisor(page: Page, aportacionMensual: string) {
  await page.goto('/advisor')
  await page.getByLabel('Edad').fill('30')
  await page.getByLabel('Ingresos mensuales').fill('40000')
  await page.getByRole('button', { name: 'Siguiente' }).click()

  await page.getByRole('button', { name: 'Media', exact: true }).click()
  await page.getByRole('button', { name: 'Mantener', exact: true }).click()
  await page.getByRole('button', { name: 'Siguiente' }).click()

  await page.getByLabel('Horizonte de inversión').fill('15')
  await page.getByRole('button', { name: 'Estable', exact: true }).click()
  await page.getByRole('button', { name: 'Siguiente' }).click()

  await page.getByLabel('Capital inicial a invertir').fill('10000')
  await page.getByLabel('Aportación mensual').fill(aportacionMensual)
  await page.getByLabel('Meta financiera').fill('400000')
  await page.getByRole('button', { name: 'Analizar perfil' }).click()

  // The analysis runs in the browser; the model line is the last thing it writes.
  await expect(page.getByText(`semilla ${ADVISOR_SEED}`)).toBeVisible({ timeout: 45_000 })
}

test.describe('signed in', () => {
  test.skip(!HAS_CREDENTIALS, SKIP_REASON)

  test('the dashboard loads with no broken values', async ({ page }) => {
    await page.goto('/dashboard')
    await expect(page.getByRole('main')).toBeVisible()
    await expectNoBrokenNumbers(page)
  })

  test('the portfolio list loads', async ({ page }) => {
    await page.goto('/portfolio')
    await expect(page).toHaveURL(/portfolio/)
    await expectNoBrokenNumbers(page)
  })

  test('a portfolio can be created', async ({ page }) => {
    const name = `${E2E_PREFIX} ${Date.now()}`
    await page.goto('/portfolio/new')
    await page.getByLabel(/nombre|name/i).first().fill(name)
    await page.getByRole('button', { name: /crear|guardar|create|save/i }).first().click()

    await expect(page).toHaveURL(/\/portfolio\/[0-9a-f-]{36}/, { timeout: 30_000 })
    const id = page.url().match(/\/portfolio\/([0-9a-f-]{36})/)![1]
    try {
      await expect(page.getByText(name).first()).toBeVisible()
    } finally {
      await page.request.delete(`/api/portfolio/${id}`)
    }
  })

  test('the market page searches and shows an asset', async ({ page }) => {
    await page.goto('/market')
    const search = page.getByPlaceholder(/buscar|search/i).first()
    await search.fill('AAPL')
    await page.waitForTimeout(1500) // debounce
    await expectNoBrokenNumbers(page)
  })

  test('the advisor answers a full questionnaire on its fixed draw', async ({ page }) => {
    await completeAdvisor(page, '1000')
    await expectNoBrokenNumbers(page)
  })

  test('an advisor plan saved as a goal shows in Metas with its pace', async ({ page }) => {
    const name = `${E2E_PREFIX} meta ${Date.now()}`
    await completeAdvisor(page, '1000')

    await page.getByLabel('Nombre', { exact: true }).fill(name)
    const book = bookPortfolioId()
    if (book) await page.getByLabel(/Seguir con un portafolio/).selectOption(book)
    await page.getByRole('button', { name: 'Guardar meta' }).click()

    const saved = page.getByRole('link', { name: 'Ver la meta' })
    await expect(saved).toBeVisible({ timeout: 30_000 })
    const goalId = (await saved.getAttribute('href'))!.split('/').pop()!
    try {
      await page.goto('/goals')
      const card = page.getByRole('link').filter({ hasText: name })
      await expect(card).toBeVisible()
      // Linked to the synthetic book it is classified; unlinked it says why not.
      await expect(
        card.getByText(book ? /Adelantada|En línea|Atrasada|Sin datos/ : /sin portafolio vinculado/),
      ).toBeVisible()
      await expectNoBrokenNumbers(page)
    } finally {
      await page.request.delete(`/api/goals/${goalId}`)
    }
  })

  test('the notification tray opens', async ({ page }) => {
    await page.goto('/dashboard')
    await page.getByRole('button', { name: /^Notificaciones/ }).click()
    await expect(page.getByText('Notificaciones', { exact: true })).toBeVisible()
    await expectNoBrokenNumbers(page)
  })

  test('the change history loads', async ({ page }) => {
    await page.goto('/settings/history')
    await expect(page.getByRole('main')).toBeVisible()
    await expectNoBrokenNumbers(page)
  })

  test('the watchlist loads', async ({ page }) => {
    await page.goto('/watchlist')
    await expectNoBrokenNumbers(page)
  })

  test('settings loads', async ({ page }) => {
    await page.goto('/settings')
    await expectNoBrokenNumbers(page)
  })
})

/**
 * The analytics surfaces, which are where a NaN is most likely and most costly.
 *
 * They read the synthetic book auth.setup.ts keeps (or E2E_PORTFOLIO_ID), and
 * skip without one rather than guessing at a portfolio and reporting a green run
 * that proved nothing.
 */
test.describe('analytics', () => {
  test.skip(!HAS_CREDENTIALS, SKIP_REASON)

  let portfolioId: string
  test.beforeEach(() => {
    const id = bookPortfolioId()
    test.skip(!id, 'No synthetic book: the setup project did not run. See docs/E2E_TESTING.md.')
    portfolioId = id!
  })

  test('the risk dashboard renders every metric without breaking one', async ({ page }) => {
    await page.goto(`/portfolio/${portfolioId}/analytics`)
    await expect(page.getByRole('main')).toBeVisible()
    // Analytics fetch in the background; give them room before reading the page.
    await page.waitForLoadState('networkidle', { timeout: 45_000 })
    await expectNoBrokenNumbers(page)
  })

  test('the analytics APIs answer without a server error', async ({ page }) => {
    for (const path of ['risk', 'returns', 'attribution', 'monte-carlo', 'exposure', 'allocation']) {
      const response = await page.request.get(`/api/analytics/${portfolioId}/${path}`)
      expect(response.status(), `/api/analytics/.../${path}`).toBeLessThan(500)

      const body = await response.text()
      // The API boundary sanitises non-finite numbers into null; this asserts
      // the guard is actually holding in a running app rather than only in unit
      // tests.
      expect(body, `${path} leaked a NaN`).not.toMatch(/:\s*NaN/)
      expect(body, `${path} leaked an Infinity`).not.toMatch(/:\s*-?Infinity/)
    }
  })

  for (const tab of ['Asignacion', 'Backtesting', '¿Qué pasaría si?']) {
    test(`the ${tab} tab renders without broken values`, async ({ page }) => {
      await page.goto(`/portfolio/${portfolioId}/analytics`)
      await page.getByRole('tab', { name: tab }).click()
      await expect(page.getByRole('tabpanel')).toBeVisible()
      await expectNoBrokenNumbers(page)
    })
  }
})
