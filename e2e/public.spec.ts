import { test, expect, expectNoBrokenNumbers } from './helpers'

/**
 * Everything reachable without signing in.
 *
 * This half runs anywhere, including CI with no secrets, which is what makes it
 * worth having: a suite that can only run on one machine gets run once.
 */

test.describe('public pages', () => {
  test('the landing page loads and offers a way in', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveTitle(/.+/)
    // Either a sign-in or a register affordance must exist, or nobody can start.
    const entry = page.getByRole('link', { name: /iniciar|entrar|registr|crear cuenta|sign in|sign up/i })
    await expect(entry.first()).toBeVisible()
  })

  test('the login page renders its form', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByLabel(/email|correo/i)).toBeVisible()
    await expect(page.getByLabel(/password|contrase/i)).toBeVisible()
    await expect(page.getByRole('button', { name: /iniciar|entrar|sign in|log in/i })).toBeVisible()
  })

  test('the register page renders its form', async ({ page }) => {
    await page.goto('/register')
    await expect(page.getByLabel(/email|correo/i)).toBeVisible()
    await expect(page.getByLabel(/password|contrase/i).first()).toBeVisible()
  })

  test('a wrong password is rejected without crashing', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel(/email|correo/i).fill('definitely-not-a-user@example.invalid')
    await page.getByLabel(/password|contrase/i).fill('wrong-password-on-purpose')
    await page.getByRole('button', { name: /iniciar|entrar|sign in|log in/i }).click()

    // The point is that it stays on the page and says something, rather than
    // navigating into a signed-in state or throwing.
    await expect(page).toHaveURL(/login/)
    await expectNoBrokenNumbers(page)
  })

  test('the dashboard redirects an anonymous visitor to login', async ({ page }) => {
    await page.goto('/dashboard')
    await expect(page).toHaveURL(/login/)
  })

  test('protected routes are all closed to anonymous visitors', async ({ page }) => {
    for (const path of ['/portfolio', '/advisor', '/watchlist', '/settings']) {
      await page.goto(path)
      await expect(page, `${path} should require a session`).toHaveURL(/login/)
    }
  })

  test('a path that is not a page answers 404, not a login form', async ({ page }) => {
    // It used to redirect to /login?next=/esta-pagina-no-existe: a visitor was
    // asked to sign in for something that would not be there afterwards.
    const response = await page.goto('/esta-pagina-no-existe')

    expect(response?.status()).toBe(404)
    await expect(page).not.toHaveURL(/login/)
    await expect(page.getByText('404')).toBeVisible()
  })
})

test.describe('the public pages render cleanly', () => {
  for (const path of ['/', '/login', '/register']) {
    test(`${path} has no broken values and no console errors`, async ({ page }) => {
      await page.goto(path)
      await expectNoBrokenNumbers(page)
      // The console-error check is enforced by the fixture in helpers.ts.
    })
  }
})

test.describe('responsive', () => {
  test('the login page is usable on a phone-sized viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto('/login')
    await expect(page.getByLabel(/email|correo/i)).toBeVisible()

    // Nothing should force the page to scroll sideways on a phone.
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    )
    expect(overflows, 'the page scrolls horizontally on a 375px viewport').toBe(false)
  })
})
