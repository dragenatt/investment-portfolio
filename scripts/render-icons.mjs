// Renders public/icons/*.svg to the PNGs the manifest and iOS use (C4).
// The PNGs were once exported by a tool without the font, and every one was a
// blank dark shape. Chromium renders the SVG text exactly as a browser would.
// Usage: node scripts/render-icons.mjs [output-dir]

import { chromium } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
const dir = path.resolve('public/icons')
const out = process.argv[2] || dir
const jobs = [
  ['icon-192.svg', 'icon-192.png', 192],
  ['icon-512.svg', 'icon-512.png', 512],
  ['icon-maskable-512.svg', 'icon-maskable-512.png', 512],
  ['apple-touch-icon.svg', 'apple-touch-icon.png', 180],
]
const browser = await chromium.launch()
for (const [svg, png, size] of jobs) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 })
  const markup = fs.readFileSync(path.join(dir, svg), 'utf8')
  await page.setContent(`<html><body style="margin:0;background:transparent">${markup.replace(/<\?xml[^>]*>/, '')}</body></html>`)
  await page.locator('svg').screenshot({ path: path.join(out, png), omitBackground: true })
  await page.close()
}
await browser.close()
console.log('rendered')
