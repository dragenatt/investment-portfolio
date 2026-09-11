import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { FACTOR_DEFINITIONS, type BuiltFactorReturns, type BuiltFactor } from './factors'

// Persistence for the factor series. The mathematics lives in factors.ts and
// stays pure; this file is the only part that touches a database.
//
// The same two-tier shape price_history already uses: read what is stored, and
// only go build it when the stored tier is thin. The difference is that factor
// returns are DERIVED, so the table can be truncated and rebuilt at any time
// without losing anything — the raw prices it comes from are the record.

/** Which construction produced a row. Bump when a factor definition changes. */
export const CONSTRUCTION_VERSION = 'etf-proxy-v1'

/** Below this many stored days, rebuild rather than regress on a stub. */
const MIN_STORED_DAYS = 60

/**
 * Factor returns are global reference data and the write path must bypass RLS,
 * exactly as baselines does. The table has a read policy for authenticated users
 * and deliberately no write policy, so the service role is the only writer.
 */
function adminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) return null
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

type FactorRow = { factor_id: string; date: string; value: number }

/**
 * Read the stored series back into the shape the regression expects.
 *
 * Only dates every stored factor has are returned. A factor that stopped being
 * written partway through would otherwise silently shorten the whole grid, and a
 * regression on a grid that changes length between runs is not reproducible.
 */
export async function loadStoredFactorReturns(
  supabase: SupabaseClient,
  since: string,
): Promise<BuiltFactorReturns | null> {
  const { data, error } = await supabase
    .from('factor_returns')
    .select('factor_id, date, value')
    .eq('construction_version', CONSTRUCTION_VERSION)
    .gte('date', since)
    .order('date', { ascending: true })

  if (error || !data || data.length === 0) return null

  const byFactor = new Map<string, Map<string, number>>()
  for (const row of data as FactorRow[]) {
    if (!Number.isFinite(row.value)) continue
    let series = byFactor.get(row.factor_id)
    if (!series) {
      series = new Map<string, number>()
      byFactor.set(row.factor_id, series)
    }
    series.set(row.date, row.value)
  }

  const ids = [...byFactor.keys()]
  if (!ids.includes('market')) return null

  const firstSeries = byFactor.get(ids[0])!
  const dates = [...firstSeries.keys()]
    .filter((date) => ids.every((id) => byFactor.get(id)!.has(date)))
    .sort()

  if (dates.length < MIN_STORED_DAYS) return null

  const factors: BuiltFactor[] = []
  for (const definition of FACTOR_DEFINITIONS) {
    const series = byFactor.get(definition.id)
    if (!series) continue
    factors.push({
      id: definition.id,
      name: definition.name,
      returns: dates.map((date) => series.get(date)!),
    })
  }

  const omitted = FACTOR_DEFINITIONS.filter((f) => !byFactor.has(f.id)).map((f) => ({
    id: f.id,
    missing: f.symbols,
  }))

  return { dates, factors, omitted }
}

/**
 * Write a freshly built series through, so the next read does not rebuild it.
 *
 * A failure here is deliberately swallowed: the caller already has the answer in
 * hand, and a cache write that did not happen is not a reason to fail a request
 * that succeeded.
 */
export async function storeFactorReturns(built: BuiltFactorReturns): Promise<number> {
  const client = adminClient()
  if (!client) return 0

  const rows = built.factors.flatMap((factor) =>
    built.dates.map((date, i) => ({
      factor_id: factor.id,
      date,
      value: factor.returns[i],
      construction_version: CONSTRUCTION_VERSION,
    })),
  ).filter((row) => Number.isFinite(row.value))

  if (rows.length === 0) return 0

  try {
    const { error } = await client
      .from('factor_returns')
      .upsert(rows, { onConflict: 'factor_id,date,construction_version' })
    return error ? 0 : rows.length
  } catch {
    return 0
  }
}
