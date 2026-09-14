// Bundle report for docs/PERFORMANCE_AUDIT.md (C3).
//
// Reads .next/diagnostics/route-bundle-stats.json, which `next build` writes, and
// prints first-load JavaScript per page route — uncompressed and gzip — plus
// the largest shared chunks and which libraries they contain. Run after a
// production build:
//
//   npm run build && node scripts/bundle-report.mjs [--json out.json]
//
// Gzip is computed here with zlib at the default level, so before/after
// numbers are comparable with each other; they will not match a CDN's brotli
// transfer sizes exactly.

import { readFileSync, writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'

const stats = JSON.parse(readFileSync('.next/diagnostics/route-bundle-stats.json', 'utf8'))

const MARKERS = {
  recharts: /recharts|RechartsWrapper|recharts-surface/,
  'd3 (via recharts)': /d3-scale|d3-shape|scaleLinear|curveMonotoneX/,
  sentry: /@sentry|__SENTRY__|sentry\.io/,
  'supabase-js': /supabase|postgrest|RealtimeClient|GoTrueClient/,
  'base-ui': /@base-ui|base-ui/,
  'lucide-react': /lucide/,
  'number-flow': /number-flow|NumberFlow/,
  swr: /useSWR|SWRConfig/,
  zod: /ZodError|zod/,
}

const size = new Map()
const gz = new Map()
const libs = new Map()
function measure(path) {
  if (size.has(path)) return
  const buf = readFileSync(path)
  size.set(path, buf.length)
  gz.set(path, gzipSync(buf).length)
  const text = buf.toString('utf8')
  libs.set(path, Object.entries(MARKERS).filter(([, re]) => re.test(text)).map(([name]) => name))
}

const pages = stats.filter((r) => !r.route.startsWith('/api'))
const rows = pages.map((r) => {
  for (const p of r.firstLoadChunkPaths) measure(p)
  const gzip = r.firstLoadChunkPaths.reduce((s, p) => s + gz.get(p), 0)
  return { route: r.route, chunks: r.firstLoadChunkPaths.length, rawKB: Math.round(r.firstLoadUncompressedJsBytes / 1024), gzipKB: Math.round(gzip / 1024) }
}).sort((a, b) => b.gzipKB - a.gzipKB)

const usage = new Map()
for (const r of pages) for (const p of r.firstLoadChunkPaths) usage.set(p, (usage.get(p) ?? 0) + 1)
const chunks = [...size.keys()]
  .map((p) => ({ chunk: p.split(/[\/]/).pop(), rawKB: Math.round(size.get(p) / 1024), gzipKB: Math.round(gz.get(p) / 1024), routes: usage.get(p), libs: libs.get(p).join(', ') }))
  .sort((a, b) => b.gzipKB - a.gzipKB)
  .slice(0, 15)

console.log('First-load JS per page route')
console.table(rows)
console.log('Largest chunks (routes = how many page routes load it on first paint)')
console.table(chunks)

const out = process.argv.indexOf('--json')
if (out > 0) writeFileSync(process.argv[out + 1], JSON.stringify({ rows, chunks }, null, 2))
