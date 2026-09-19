// @vitest-environment node
//
// 4.5, enforced: audit_log and notifications are written in one place each,
// through the service role.
//
// Both tables had zero rows. The goal routes did call the audit writer, with
// the user's own client — and both tables grant the authenticated role no
// INSERT, so every write was refused and logged where nobody looked. A route
// inserting into either table directly would repeat that, silently.

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

describe('audit and notification writers', () => {
  const files = sourceFiles(ROOT)

  it('only audit.ts touches audit_log', () => {
    const offenders = files.filter((f) => /from\(\s*['"]audit_log['"]\s*\)/.test(fs.readFileSync(f, 'utf8')))
    expect(offenders.map(rel)).toEqual(['lib/services/audit.ts'])
  })

  it('only notifications.ts inserts notifications', () => {
    const offenders = files.filter((f) =>
      /from\(\s*['"]notifications['"]\s*\)\s*\.insert/.test(fs.readFileSync(f, 'utf8').replace(/\s+/g, ' ')),
    )
    expect(offenders.map(rel)).toEqual(['lib/services/notifications.ts'])
  })

  it('no caller hands the audit writer a client — it picks the service role itself', () => {
    const offenders = files.filter((f) => /recordAudit(?:Changes)?\(\s*supabase\b/.test(fs.readFileSync(f, 'utf8')))
    expect(offenders.map(rel)).toEqual([])
  })
})
