// Automated WCAG 2.1 A/AA checks (C5) with axe-core, against a running build.
//
//   npx next build && npx next start -p 3100
//   node scripts/a11y-audit.mjs http://localhost:3100 / /login /register /offline
//
// Signed out, in light and dark colour schemes, desktop and phone widths.
// Signed-in pages need a session this script has no business holding; they are
// audited in a browser that is already signed in (docs/ACCESSIBILITY_AUDIT.md
// has the snippet). JSON_OUT=path writes the full result.
//
// axe finds roughly a third to a half of WCAG failures: the ones a program can
// decide. Keyboard order, screen-reader wording and chart alternatives were
// checked by hand and are recorded in the audit document.

import { chromium } from '@playwright/test'
import fs from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const axePath = require.resolve('axe-core/axe.min.js')

const [baseArg, ...routeArgs] = process.argv.slice(2)
const base = (baseArg || 'http://localhost:3100').replace(/\/$/, '')
const routes = routeArgs.length > 0 ? routeArgs : ['/', '/login', '/register', '/offline']
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

const variants = [
  { name: 'desktop-light', viewport: { width: 1280, height: 800 }, colorScheme: 'light' },
  // The app's default theme is light whatever the system says, so dark mode is
  // selected the way the theme toggle stores it, not through colorScheme alone.
  { name: 'desktop-dark', viewport: { width: 1280, height: 800 }, colorScheme: 'dark', theme: 'dark' },
  { name: 'phone-light', viewport: { width: 390, height: 844 }, colorScheme: 'light' },
]

const browser = await chromium.launch()
const results = []

for (const variant of variants) {
  const context = await browser.newContext({ viewport: variant.viewport, colorScheme: variant.colorScheme, reducedMotion: 'reduce' })
  if (variant.theme) await context.addInitScript((theme) => localStorage.setItem('theme', theme), variant.theme)
  for (const route of routes) {
    const page = await context.newPage()
    await page.goto(base + route, { waitUntil: 'networkidle' })
    await page.addScriptTag({ path: axePath })
    const axe = await page.evaluate(async (tags) => {
      // eslint-disable-next-line no-undef
      const result = await axe.run(document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations'] })
      return result.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        help: v.help,
        nodes: v.nodes.slice(0, 8).map((n) => ({ target: n.target.join(' '), summary: n.failureSummary?.split('\n').slice(1, 3).join(' ') })),
        count: v.nodes.length,
      }))
    }, TAGS)
    results.push({ variant: variant.name, route, violations: axe })
    await page.close()
  }
  await context.close()
}
await browser.close()

let total = 0
for (const { variant, route, violations } of results) {
  const count = violations.reduce((sum, v) => sum + v.count, 0)
  total += count
  console.log(`${variant.padEnd(14)} ${route.padEnd(12)} ${count === 0 ? 'no violations' : `${count} nodes`}`)
  for (const v of violations) {
    console.log(`   [${v.impact}] ${v.id} (${v.count}): ${v.help}`)
    for (const n of v.nodes.slice(0, 4)) console.log(`      ${n.target}  ${n.summary ?? ''}`)
  }
}
if (process.env.JSON_OUT) fs.writeFileSync(process.env.JSON_OUT, JSON.stringify(results, null, 2))
console.log(`\n${total} violating nodes in total`)
