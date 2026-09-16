// @vitest-environment node
//
// P0-20, enforced: a financial constant has one definition.
//
// `252` was declared seventeen times under src/lib and written as a bare
// literal twice more inside analytics.ts — four lines above its own copy of the
// constant. Every copy held the same value, so nothing was wrong numerically;
// what was wrong is that "what does this system assume?" could not be answered
// without grepping, and changing it would have been seventeen edits with
// seventeen chances to miss one.
//
// This test fails when a new copy appears.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '../../src')
const HOME = path.join(ROOT, 'lib/constants/financial-constants.ts')

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(full)
    return /\.tsx?$/.test(entry.name) ? [full] : []
  })
}

const rel = (file: string) => path.relative(ROOT, file).replace(/\\/g, '/')

/** Code only: comments and doc blocks may say 252 as prose. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

describe('financial constants have one home', () => {
  const files = sourceFiles(ROOT).filter((file) => file !== HOME)

  it('the home module exists and holds the value', () => {
    expect(fs.existsSync(HOME)).toBe(true)
    expect(fs.readFileSync(HOME, 'utf8')).toMatch(/export const TRADING_DAYS_PER_YEAR = 252/)
  })

  it('nothing else declares its own trading-day constant', () => {
    const offenders = files.filter((file) =>
      /\bconst\s+[A-Z_]*(?:TRADING_DAYS|DAYS_PER_YEAR)[A-Z_]*\s*=\s*252\b/.test(withoutComments(fs.readFileSync(file, 'utf8'))),
    )
    expect(offenders.map(rel)).toEqual([])
  })

  it('no source file writes 252 as a bare number', () => {
    // Anywhere it appears in code it should be the imported constant, so that a
    // reader never has to decide whether a given 252 means trading days.
    const offenders = files.filter((file) => /(?<![\w.])252(?![\w.])/.test(withoutComments(fs.readFileSync(file, 'utf8'))))
    expect(offenders.map(rel)).toEqual([])
  })
})
