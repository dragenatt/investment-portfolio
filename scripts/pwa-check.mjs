// Automated PWA checks (C4) against a running production build.
//
//   npx next build && npx next start -p 3100
//   node scripts/pwa-check.mjs http://localhost:3100
//
// Headless Chromium, signed out, so it needs no credentials. It checks what can
// be checked without a phone: Chromium's own installability verdict (the same
// criteria Android Chrome applies), the manifest as the browser parsed it, that
// the service worker installs and takes control, and that pages work offline.
// Installing on real Android and iOS devices is a manual checklist in
// docs/PWA_TESTING.md.

import { chromium } from '@playwright/test'

const base = (process.argv[2] || 'http://localhost:3100').replace(/\/$/, '')
const report = {}

const browser = await chromium.launch()
const context = await browser.newContext()
const page = await context.newPage()
const cdp = await context.newCDPSession(page)

await page.goto(base + '/', { waitUntil: 'load' })
await page.evaluate(() => navigator.serviceWorker.ready)
// The first load happened before the worker existed; the next one goes through it.
await page.reload({ waitUntil: 'load' })

report.controlled = await page.evaluate(() => Boolean(navigator.serviceWorker.controller))
report.scriptURL = await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? null)

const installability = await cdp.send('Page.getInstallabilityErrors')
report.installabilityErrors = installability.installabilityErrors.map((e) => e.errorId)

const manifest = await cdp.send('Page.getAppManifest')
report.manifestUrl = manifest.url
report.manifestErrors = manifest.errors.map((e) => e.message)
// `manifest` is the browser's parsed view; the older `parsed` field only has scope.
const parsed = manifest.manifest ?? manifest.parsed ?? {}
report.manifest = {
  id: parsed.id?.replace(base, ''),
  name: parsed.name,
  display: parsed.display,
  startUrl: parsed.startUrl?.replace(base, ''),
  scope: parsed.scope?.replace(base, ''),
  orientation: parsed.orientation,
  icons: (parsed.icons ?? []).map((icon) => `${icon.url.replace(base, '')} ${icon.sizes ?? ''}`.trim()),
  shortcuts: (parsed.shortcuts ?? []).map((shortcut) => shortcut.name),
}

report.appleTouchIcon = await page.evaluate(async () => {
  const link = document.querySelector('link[rel="apple-touch-icon"]')
  if (!link) return null
  const response = await fetch(link.href)
  const bitmap = await createImageBitmap(await response.blob())
  return { href: link.getAttribute('href'), status: response.status, size: `${bitmap.width}x${bitmap.height}` }
})

report.cachesOnline = await page.evaluate(() => caches.keys())

await context.setOffline(true)

const landing = await page.goto(base + '/', { waitUntil: 'load' }).catch((error) => error)
report.offlineLanding = {
  ok: !(landing instanceof Error) && landing?.ok(),
  fromServiceWorker: !(landing instanceof Error) && landing?.fromServiceWorker(),
  headline: await page.locator('h1').first().textContent().catch(() => null),
}

const unsaved = await page.goto(base + '/discover', { waitUntil: 'load' }).catch((error) => error)
report.offlineUnsavedPage = {
  fromServiceWorker: !(unsaved instanceof Error) && unsaved?.fromServiceWorker(),
  heading: await page.locator('h1').first().textContent().catch(() => null),
  styled: await page
    .evaluate(() => getComputedStyle(document.querySelector('main')).display === 'flex')
    .catch(() => false),
}

const data = await page.evaluate(async () => {
  const response = await fetch('/api/rates')
  return { status: response.status, source: response.headers.get('x-sw-source'), body: await response.text() }
})
report.offlineUnsavedApi = data

await context.setOffline(false)
await browser.close()

console.log(JSON.stringify(report, null, 2))
