// @vitest-environment node
//
// The Sentry SDK is never imported at module scope, on either side.
//
// On the client that rule already exists, written down in
// instrumentation-client.ts: 454 KB downloaded and parsed on every page for an
// error reporter with no DSN to report to. The server had the same problem and
// it cost more: api/handler.ts and api/response.ts are on the path of every API
// route, instrumentation.ts runs before the first request of every server
// instance, and 1.65 MB was loaded again on every cold start — of which this app
// has many, since Vercel reclaims idle functions. Measured on the built app,
// three runs each: the first API request went from ~73 ms to ~34 ms.
//
// A static import anywhere under src/ puts it back on the boot path, so this
// fails instead. Reports go through lib/observability/sentry.ts, which loads the
// SDK on demand and only when SENTRY_DSN is set. The two sentry.*.config.ts
// files at the repository root are the exception by design: they exist to be
// imported on demand, by that module and by instrumentation.ts.

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

const rel = (file: string) => path.relative(ROOT, file).split(path.sep).join('/')

/** `import ... from '@sentry/nextjs'`, but not `import type` and not `await import(...)`. */
const STATIC_IMPORT = /^\s*import\s+(?!type\b)[^;]*?from\s+['"]@sentry\/nextjs['"]/m

describe('the Sentry SDK and the boot path', () => {
  it('is imported at module scope by nothing under src/', () => {
    const offenders = sourceFiles(ROOT)
      .filter((file) => STATIC_IMPORT.test(fs.readFileSync(file, 'utf8')))
      .map(rel)

    expect(offenders).toEqual([])
  })

  it('is reached through the on-demand module, which imports it dynamically', () => {
    const source = fs.readFileSync(path.join(ROOT, 'lib/observability/sentry.ts'), 'utf8')

    expect(source).toMatch(/await import\('@sentry\/nextjs'\)/)
    // A type-only import is erased by the compiler and costs nothing at runtime.
    expect(source).toMatch(/import type \* as Sentry from '@sentry\/nextjs'/)
  })

  it('is not loaded by the server instrumentation before the first request', () => {
    const source = fs.readFileSync(path.join(ROOT, 'instrumentation.ts'), 'utf8')

    expect(STATIC_IMPORT.test(source)).toBe(false)
    // register() must complete before the server serves anything, so it returns
    // immediately when there is nothing to report to.
    expect(source).toMatch(/if \(!reportingEnabled\(\)\) return/)
  })
})
