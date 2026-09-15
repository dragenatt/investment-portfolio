// @vitest-environment node
//
// P2-10, enforced: every analytics result says where it comes from.
//
// Each route under /api/analytics/[pid] must build result metadata — itself,
// through the risk-inputs loader, or through the background-job calculation it
// runs — and a route that caches its result must use a wrapper that records
// whether the result was computed or served from the cache. A plain withCache
// would store the metadata and then hand back "computed" forever.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '../../src')
const ANALYTICS = path.join(ROOT, 'app/api/analytics/[pid]')

function routeFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return routeFiles(full)
    return entry.name === 'route.ts' ? [full] : []
  })
}

const BUILDS_METADATA = /\b(buildResultMetadata|riskInputsMetadata)\(/

/** The job calculations a route imports, resolved to their files. */
function importedJobKinds(source: string): string[] {
  return [...source.matchAll(/from '@\/lib\/jobs\/kinds\/([\w-]+)'/g)].map((m) => path.join(ROOT, 'lib/jobs/kinds', `${m[1]}.ts`))
}

function buildsMetadata(file: string): boolean {
  const source = fs.readFileSync(file, 'utf8')
  if (BUILDS_METADATA.test(source)) return true
  return importedJobKinds(source).some((kind) => fs.existsSync(kind) && BUILDS_METADATA.test(fs.readFileSync(kind, 'utf8')))
}

const rel = (file: string) => path.relative(ROOT, file).replace(/\\/g, '/')

describe('result metadata on analytics routes', () => {
  const routes = routeFiles(ANALYTICS)

  it('finds the analytics routes', () => {
    expect(routes.length).toBeGreaterThanOrEqual(19)
  })

  it('every analytics route builds metadata for its result', () => {
    expect(routes.filter((file) => !buildsMetadata(file)).map(rel)).toEqual([])
  })

  it('no analytics route caches a result with a wrapper that cannot say it was cached', () => {
    const plain = routes.filter((file) => /\bwithCache(?:<[^>]*>)?\(/.test(fs.readFileSync(file, 'utf8')))
    expect(plain.map(rel)).toEqual([])
  })

  it('every background job calculation builds metadata', () => {
    const kinds = fs.readdirSync(path.join(ROOT, 'lib/jobs/kinds'))
      .filter((name) => name.endsWith('.ts') && name !== 'risk-inputs.ts')
      .map((name) => path.join(ROOT, 'lib/jobs/kinds', name))
    expect(kinds.filter((file) => !BUILDS_METADATA.test(fs.readFileSync(file, 'utf8'))).map(rel)).toEqual([])
  })
})
