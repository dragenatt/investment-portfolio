import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { withAuditedCache } from '@/lib/cache/with-cache'
import { CACHE_KEYS } from '@/lib/cache/redis'
import { computeMonteCarlo } from '@/lib/jobs/kinds/monte-carlo'
import { normaliseJobParams } from '@/lib/services/jobs'

// Synchronous entry point, kept for existing callers. The calculation itself
// lives in src/lib/jobs/kinds so the background job (POST /api/jobs, C1) runs
// exactly the same code.

export async function GET(req: Request, { params }: { params: Promise<{ pid: string }> }) {
  const { pid } = await params
  // Same clamping as the job, so both paths mean the same horizon.
  const { weeks } = normaliseJobParams('monteCarlo', {
    weeks: new URL(req.url).searchParams.get('weeks') ?? undefined,
  })

  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const data = await withAuditedCache(`${CACHE_KEYS.ANALYTICS_MONTE_CARLO}${user.id}:${pid}:${weeks}`, 300, () =>
    computeMonteCarlo(supabase, pid, { weeks }),
  )
  return success(data)
}
