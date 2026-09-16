import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { withAuditedCache } from '@/lib/cache/with-cache'
import { apiHandler } from '@/lib/api/handler'
import { computeOptimization, type OptimizationParams } from '@/lib/jobs/kinds/optimization'

// Synchronous entry point, kept for existing callers. The calculation itself
// lives in src/lib/jobs/kinds so the background job (POST /api/jobs, C1) runs
// exactly the same code.

/** A percentage in the query string as a fraction, or undefined when absent or unusable. */
function fraction(raw: string | null): number | undefined {
  if (raw === null) return undefined
  const percent = Number(raw)
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) return undefined
  return percent / 100
}

/**
 * Sector caps as `Technology:40,Energy:25` — percentages, to match the other two.
 *
 * A compact encoding because this is a GET whose result is cached by URL; a
 * malformed pair is dropped rather than failing the whole request, since a cap
 * nobody can parse should not take the frontier down with it.
 */
function sectorCaps(raw: string | null): Record<string, number> | undefined {
  if (!raw) return undefined
  const caps: Record<string, number> = {}
  for (const pair of raw.split(',')) {
    const separator = pair.lastIndexOf(':')
    if (separator <= 0) continue
    const sector = pair.slice(0, separator).trim()
    const cap = fraction(pair.slice(separator + 1).trim())
    if (sector && cap !== undefined) caps[sector] = cap
  }
  return Object.keys(caps).length > 0 ? caps : undefined
}

/** An annual return percentage as a fraction. Negative is allowed: a floor can be a loss. */
function annualReturn(raw: string | null): number | undefined {
  if (raw === null) return undefined
  const percent = Number(raw)
  if (!Number.isFinite(percent) || percent < -100 || percent > 1000) return undefined
  return percent / 100
}

/** The part of the cache key that describes the constraints, so two different asks do not share a result. */
function constraintKey(params: OptimizationParams): string {
  const caps = Object.entries(params.sectorCaps ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([sector, cap]) => `${sector}=${cap}`)
    .join('|')
  return `${params.minWeight ?? ''}:${params.maxWeight ?? ''}:${params.minReturn ?? ''}:${caps}`
}

async function getHandler(req: Request, { params }: { params: Promise<{ pid: string }> }) {
  const { pid } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  // P1-31 lists minimum weight, maximum weight and sector caps as inputs to the
  // optimisation. With none supplied the behaviour is exactly what it was.
  const url = new URL(req.url)
  const constraints: OptimizationParams = {
    minWeight: fraction(url.searchParams.get('minWeight')),
    maxWeight: fraction(url.searchParams.get('maxWeight')),
    sectorCaps: sectorCaps(url.searchParams.get('sectorCaps')),
    // P1-32's "minimise CVaR subject to a minimum return", as an annual percentage.
    minReturn: annualReturn(url.searchParams.get('minReturn')),
  }

  const data = await withAuditedCache(
    `analytics:optimization:${user.id}:${pid}:${constraintKey(constraints)}`,
    900,
    () => computeOptimization(supabase, pid, constraints),
  )

  return success(data)
}

export const GET = apiHandler(getHandler)
