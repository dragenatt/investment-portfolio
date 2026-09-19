// @vitest-environment node
//
// 5.3. The contract tests (tests/contracts) only protect the routes they know
// about, and the hook types only protect the screens that use the hooks. This
// keeps both true as the app grows: every analytics route has a contract or is
// named as having no screen, every URL a screen requests is a contracted route,
// and only use-analytics.ts builds those URLs — the one place their types come
// from the contracts. The RiskMetrics card that read `data.sharpe` from a route
// that sends `current.sharpe_ratio` was the one file that did not.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { ANALYTICS_CONTRACTS } from '@/lib/contracts/analytics'

const SRC = path.resolve(__dirname, '../../src')
const ROUTES = path.join(SRC, 'app/api/analytics/[pid]')
const HOOKS = path.join(SRC, 'lib/hooks/use-analytics.ts')

/** Routes nothing in the app requests, so there is no screen to hold them to. */
const NO_SCREEN: Record<string, string> = {
  benchmark: 'Índices pedidos, normalizados a su primer cierre del año; ninguna pantalla lo pide.',
  performance: 'Posiciones abiertas y sus cierres diarios en bruto; ninguna pantalla lo pide.',
}

function routeSegments(dir: string, prefix = ''): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (!entry.isDirectory()) return []
    const segment = prefix ? `${prefix}/${entry.name}` : entry.name
    const inside = path.join(dir, entry.name)
    const own = fs.existsSync(path.join(inside, 'route.ts')) ? [segment] : []
    return [...own, ...routeSegments(inside, segment)]
  })
}

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(full)
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : []
  })
}

const contracted = new Set(Object.keys(ANALYTICS_CONTRACTS))

describe('analytics routes and their contracts', () => {
  it('every route has a contract, or is named as having no screen', () => {
    const missing = routeSegments(ROUTES).filter((segment) => !contracted.has(segment) && !(segment in NO_SCREEN))
    expect(missing).toEqual([])
  })

  it('every contract is for a route that exists', () => {
    const existing = new Set(routeSegments(ROUTES))
    expect([...contracted].filter((segment) => !existing.has(segment))).toEqual([])
  })

  it('only use-analytics.ts builds a URL for a portfolio analytics route', () => {
    const offenders = sourceFiles(SRC)
      .filter((file) => file !== HOOKS && !file.startsWith(path.join(SRC, 'app/api')))
      .filter((file) => /\/api\/analytics\/\$\{/.test(fs.readFileSync(file, 'utf8')))
      .map((file) => path.relative(SRC, file))
    expect(offenders).toEqual([])
  })

  it('every route the hooks request is contracted', () => {
    const source = fs.readFileSync(HOOKS, 'utf8')
    const requested = [...source.matchAll(/\/api\/analytics\/\$\{pid\}\/([a-z-]+(?:\/[a-z-]+)?)/g)].map((m) => m[1])
    expect(requested.length).toBeGreaterThan(0)
    expect(requested.filter((segment) => !contracted.has(segment))).toEqual([])
  })

  it('declares no payload type by hand in use-analytics.ts', () => {
    // Types for other APIs (alerts, discover) still live there; analytics
    // payloads are inferred from the contracts.
    const source = fs.readFileSync(HOOKS, 'utf8')
    const handWritten = [...source.matchAll(/export type (\w+) = \{/g)].map((m) => m[1])
    expect(handWritten.sort()).toEqual(['LeaderboardHistoryEntry', 'PortfolioAlert', 'WinnersLosersData'])
  })
})
