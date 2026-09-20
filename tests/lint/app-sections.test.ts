import { describe, it, expect } from 'vitest'
import { readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { APP_SECTIONS } from '@/lib/supabase/middleware'

// The proxy decides whether a path without a session is a page to sign in for
// or a page that does not exist. It cannot read the filesystem at the edge, so
// it carries a list — and a list drifts. This is what keeps it honest: add a
// section under src/app/(app) and forget this list, and the new section sends
// visitors to a 404 instead of the login page.

const APP_DIR = join(process.cwd(), 'src', 'app')

function directoriesIn(path: string): string[] {
  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
}

describe('the sections the proxy knows about', () => {
  it('are exactly the folders under src/app/(app)', () => {
    const onDisk = directoriesIn(join(APP_DIR, '(app)')).sort()
    expect([...APP_SECTIONS].sort()).toEqual(onDisk)
  })

  it('names no section twice', () => {
    expect(new Set(APP_SECTIONS).size).toBe(APP_SECTIONS.length)
  })

  it('leaves out the route groups, which are not URL segments', () => {
    for (const section of APP_SECTIONS) {
      expect(section.startsWith('(')).toBe(false)
    }
  })

  it('still has a page to fall through to', () => {
    expect(existsSync(join(APP_DIR, 'not-found.tsx'))).toBe(true)
  })
})
