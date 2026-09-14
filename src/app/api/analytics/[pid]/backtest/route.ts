import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { withCache } from '@/lib/cache/with-cache'
import { apiHandler } from '@/lib/api/handler'
import { computeBacktest } from '@/lib/jobs/kinds/backtest'

// Synchronous entry point, kept for existing callers. The calculation itself
// lives in src/lib/jobs/kinds so the background job (POST /api/jobs, C1) runs
// exactly the same code.

async function getHandler(req: Request, { params }: { params: Promise<{ pid: string }> }) {
  const { pid } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const url = new URL(req.url)
  const costPct = Number(url.searchParams.get('cost') ?? 0.1)

  const data = await withCache(`analytics:backtest:${pid}:${costPct}`, 3600, () =>
    computeBacktest(supabase, pid, { costPct }),
  )

  return success(data)
}

export const GET = apiHandler(getHandler)
