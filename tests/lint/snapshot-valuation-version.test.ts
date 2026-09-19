// @vitest-environment node
//
// Snapshots written before migration 024 summed quote and cost currencies as
// one unit; a reader that mixes one of them with a converted row sees a
// seventeen-fold jump. Every file that reads portfolio_snapshots must filter on
// SNAPSHOT_VALUATION_VERSION.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '../../src')

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(full)
    return /\.tsx?$/.test(entry.name) ? [full] : []
  })
}

const rel = (file: string) => path.relative(ROOT, file).replace(/\\/g, '/')

describe('snapshot readers skip mixed-currency rows', () => {
  it('every file that selects from portfolio_snapshots filters on the valuation version', () => {
    const offenders = sourceFiles(ROOT).filter((file) => {
      const flat = fs.readFileSync(file, 'utf8').replace(/\s+/g, ' ')
      const reads = /from\(\s*'portfolio_snapshots'\s*\)\s*\.select\(/.test(flat)
      return reads && !flat.includes('SNAPSHOT_VALUATION_VERSION')
    })
    expect(offenders.map(rel)).toEqual([])
  })

  it('the snapshot writer stamps the version it values at', () => {
    const source = fs.readFileSync(path.join(ROOT, 'lib/services/snapshots.ts'), 'utf8')
    expect(source).toMatch(/valuation_version: SNAPSHOT_VALUATION_VERSION/)
  })
})
