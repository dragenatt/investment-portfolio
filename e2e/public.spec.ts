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

test.describe('the public pages are navigable', () => {
  // Every page shared one title and one description, the two auth pages had no
  // heading and no main landmark, and no field carried autocomplete — which is
  // what a password manager and a phone keyboard read.
  const titles: Array<[string, RegExp]> = [
    ['/', /InvestTracker/],
    ['/login', /Iniciar sesión · InvestTracker/],
    ['/register', /Crear cuenta · InvestTracker/],
  ]

  for (const [path, title] of titles) {
    test(`${path} says what page it is`, async ({ page }) => {
      await page.goto(path)
      await expect(page).toHaveTitle(title)
    })
  }

  for (const path of ['/', '/login', '/register']) {
    test(`${path} has one main landmark and one h1`, async ({ page }) => {
      await page.goto(path)
      await expect(page.locator('main')).toHaveCount(1)
      await expect(page.locator('h1')).toHaveCount(1)
    })
  }

  test('the sign-in fields are the ones a password manager fills', async ({ page }) => {
    await page.goto('/login')
    await expect(page.locator('#email')).toHaveAttribute('autocomplete', 'email')
    await expect(page.locator('#password')).toHaveAttribute('autocomplete', 'current-password')
  })

  test('registering asks for a new password, not the saved one', async ({ page }) => {
    await page.goto('/register')
    await expect(page.locator('#password')).toHaveAttribute('autocomplete', 'new-password')
    await expect(page.locator('#email')).toHaveAttribute('autocomplete', 'email')
  })
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
