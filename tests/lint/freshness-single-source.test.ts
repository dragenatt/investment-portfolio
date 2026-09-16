// @vitest-environment node
//
// 4.4, enforced: "is this price current?" has one answer, in freshness.ts.
//
// The app had three: freshness.ts itself, `stale: quote === undefined` in the
// allocation breakdown, and `is_stale: !livePrices[symbol]` on the portfolio
// page. The two binary flags could only say "missing" or "fine", so a price
// saved on Friday passed as current on both. This fails when a local flag like
// them comes back.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '../../src')
const HOME = path.join(ROOT, 'lib/services/freshness.ts')

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(full)
    return /\.tsx?$/.test(entry.name) ? [full] : []
  })
}

const rel = (file: string) => path.relative(ROOT, file).replace(/\\/g, '/')

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

describe('price freshness has one source', () => {
  const files = sourceFiles(ROOT).filter((file) => file !== HOME)

  it('no screen or route keeps its own stale flag for a price', () => {
    // `is_stale` and a bare `stale:` / `.stale` property are the shapes the two
    // retired flags had. Other uses of the word — stale-while-revalidate, stale
    // jobs, a stale price history, spreading a variable named `stale` — are
    // different questions and do not match.
    const offenders = files.filter((file) =>
      /\bis_stale\b|(?<![\w$])stale\s*:|(?<!\.\.)\.stale\b/.test(withoutComments(fs.readFileSync(file, 'utf8'))),
    )
    expect(offenders.map(rel)).toEqual([])
  })

  it('the screens that mark freshness get it from freshness.ts', () => {
    for (const file of [
      'lib/services/allocation-breakdown.ts',
      'app/(app)/portfolio/[id]/page.tsx',
      'components/dashboard/position-pnl-table.tsx',
    ]) {
      expect(fs.readFileSync(path.join(ROOT, file), 'utf8'), file).toMatch(/from '(?:\.\/|@\/lib\/services\/)freshness'/)
    }
  })
})
