import { after } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { apiHandler } from '@/lib/api/handler'
import { createAdminSupabase } from '@/lib/services/snapshots'
import { reconcile, executeJob, publicJob, type JobRow } from '@/lib/jobs/runner'

// A retry claimed by this poll runs in after() within this invocation.
export const maxDuration = 60

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * The state of a background job, brought up to date before it is reported.
 *
 * A job past its deadline is never reported as `processing`: reading it here
 * either claims its next attempt (and runs it after this response) or fails it
 * with a timeout. That is what guarantees no job waits forever on a worker that
 * no longer exists.
 */
async function getHandler(_req: Request, { params }: { params: Promise<{ job_id: string }> }) {
  const { job_id: jobId } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)
  if (!UUID.test(jobId)) return error('job_id no es valido.', 400)

  // Read through the user's client: RLS only returns the user's own jobs, so a
  // guessed id belonging to someone else is simply not found.
  const { data: row } = await supabase.from('analytics_jobs').select('*').eq('id', jobId).maybeSingle()
  if (!row) return error('Job no encontrado.', 404)

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return success(publicJob(row as JobRow))

  const admin = createAdminSupabase()
  const dispatch = await reconcile(admin, row as JobRow)

  if (dispatch.run) {
    after(async () => {
      const userClient = await createServerSupabase()
      await executeJob(admin, userClient, dispatch.job)
    })
  }

  return success(publicJob(dispatch.job))
}

export const GET = apiHandler(getHandler)
