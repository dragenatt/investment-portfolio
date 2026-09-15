import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { withAuditedCache } from '@/lib/cache/with-cache'
import { apiHandler } from '@/lib/api/handler'
import { computeFactors } from '@/lib/jobs/kinds/factors'

// Synchronous entry point, kept for existing callers. The calculation itself
// lives in src/lib/jobs/kinds so the background job (POST /api/jobs, C1) runs
// exactly the same code.

async function getHandler(_req: Request, { params }: { params: Promise<{ pid: string }> }) {
  const { pid } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const data = await withAuditedCache(`analytics:factors:${user.id}:${pid}`, 1800, () => computeFactors(supabase, pid, {}))

  return success(data)
}

export const GET = apiHandler(getHandler)
