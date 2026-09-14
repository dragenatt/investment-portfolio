// Lab Core Web Vitals for docs/PERFORMANCE_AUDIT.md (C3).
//
// Loads each URL in headless Chromium against a production server, several
// times with a fresh context, and reports the median LCP, CLS and INP plus the
// JavaScript downloaded. INP needs an interaction, so each run clicks a real
// control and records the longest event duration.
//
//   npm run build && npx next start -p 3100
//   node scripts/web-vitals-lab.mjs http://localhost:3100 / /login
//
// Throttled to Lighthouse's mobile profile by default; THROTTLE=0 turns it off.
//
// Lab numbers are for before/after comparison on the same machine, not a
// substitute for field data: CPU, network and cache all differ for real users.

import { chromium } from '@playwright/test'

const [base = 'http://localhost:3100', ...paths] = process.argv.slice(2)
const routes = paths.length > 0 ? paths : ['/', '/login']
const RUNS = Number(process.env.RUNS ?? 5)

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

const browser = await chromium.launch()
const results = []

for (const path of routes) {
  const samples = []
  for (let run = 0; run < RUNS; run++) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    const page = await context.newPage()
    // Lighthouse's mobile profile: 4x CPU slowdown, 150 ms RTT, 1.6 Mbps down,
    // 750 kbps up. Unthrottled on localhost every page paints in ~65 ms and the
    // numbers say nothing; throttled, JavaScript weight shows up in LCP and INP.
    if (process.env.THROTTLE !== '0') {
      const cdp = await context.newCDPSession(page)
      await cdp.send('Network.enable')
      await cdp.send('Network.emulateNetworkConditions', {
        offline: false,
        latency: 150,
        downloadThroughput: (1.6 * 1024 * 1024) / 8,
        uploadThroughput: (750 * 1024) / 8,
      })
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
    }
    await page.addInitScript(() => {
      window.__vitals = { lcp: 0, cls: 0, inp: 0 }
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) window.__vitals.lcp = e.startTime
      }).observe({ type: 'largest-contentful-paint', buffered: true })
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) if (!e.hadRecentInput) window.__vitals.cls += e.value
      }).observe({ type: 'layout-shift', buffered: true })
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) if (e.interactionId) window.__vitals.inp = Math.max(window.__vitals.inp, e.duration)
      }).observe({ type: 'event', buffered: true, durationThreshold: 16 })
    })
    await page.goto(base + path, { waitUntil: 'load' })
    await page.waitForTimeout(2500)
    // One real interaction for INP: the first visible button or link.
    const target = page.locator('button:visible, a:visible').first()
    if (await target.count()) {
      await target.hover()
      await page.mouse.down()
      await page.mouse.up()
      await page.waitForTimeout(800)
    }
    const vitals = await page.evaluate(() => {
      const js = performance.getEntriesByType('resource').filter((e) => /\.js(\?|$)/.test(e.name))
      return { ...window.__vitals, jsKB: Math.round(js.reduce((s, e) => s + e.encodedBodySize, 0) / 1024) }
    })
    samples.push(vitals)
    await context.close()
  }
  results.push({
    route: path,
    runs: RUNS,
    lcpMs: Math.round(median(samples.map((s) => s.lcp))),
    cls: Number(median(samples.map((s) => s.cls)).toFixed(4)),
    inpMs: Math.round(median(samples.map((s) => s.inp))),
    jsKB: median(samples.map((s) => s.jsKB)),
  })
}

await browser.close()
console.table(results)
if (process.env.JSON_OUT) {
  const { writeFileSync } = await import('node:fs')
  writeFileSync(process.env.JSON_OUT, JSON.stringify(results, null, 2))
}
