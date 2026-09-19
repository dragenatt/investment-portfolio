import { after } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { apiHandler } from '@/lib/api/handler'
import { createAdminSupabase } from '@/lib/services/snapshots'
import { isJobKind, normaliseJobParams } from '@/lib/services/jobs'
import { findOrCreateJob, executeJob, publicJob } from '@/lib/jobs/runner'
import { recordFunnelEvent } from '@/lib/analytics/funnel'
import { FUNNEL_EVENTS } from '@/lib/analytics/events'

// The first attempt runs in after() within this invocation. Must stay above every
// JOB_POLICY timeout (JOB_MAX_DURATION_SECONDS); a literal, because route
// segment config has to be statically analysable.
export const maxDuration = 60

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Start a heavy calculation in the background (C1).
 *
 * `POST { kind, portfolio_id, params }` answers at once with the job — 202 and
 * `processing` for new work, 200 and the result when a fresh one already
 * exists — and the calculation runs after the response. Poll
 * GET /api/jobs/[job_id]/status for the outcome.
 */
async function postHandler(req: Request) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const body = (await req.json().catch(() => null)) as
    | { kind?: unknown; portfolio_id?: unknown; params?: unknown }
    | null
  if (!body || !isJobKind(body.kind)) return error('Tipo de calculo desconocido.', 400)
  if (typeof body.portfolio_id !== 'string' || !UUID.test(body.portfolio_id)) {
    return error('portfolio_id no es valido.', 400)
  }

  // Row-level security decides whether this user may see the portfolio at all.
  // The calculation runs with the same client, so this is the same rule the
  // synchronous route applied — checked before a job row is ever written.
  const { data: portfolio } = await supabase
    .from('portfolios')
    .select('id')
    .eq('id', body.portfolio_id)
    .maybeSingle()
  if (!portfolio) return error('Portafolio no encontrado.', 404)

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return error('Los calculos en segundo plano no estan disponibles en este entorno.', 503)
  }

  const admin = createAdminSupabase()
  const kind = body.kind
  const dispatch = await findOrCreateJob(admin, {
    userId: user.id,
    portfolioId: body.portfolio_id,
    kind,
    params: normaliseJobParams(kind, body.params),
  })

  // The funnel's backtesting step (012 reserved it for P1-1; the screen that
  // runs one exists since 4.3/4.8). Only a run counts — a reused job is the
  // same answer served again — and it never fails the request.
  if (dispatch.run && kind === 'backtest') {
    after(() => recordFunnelEvent(FUNNEL_EVENTS.BACKTEST_RUN, user.id))
  }

  if (dispatch.run) {
    after(async () => {
      // A fresh client inside after(): Route Handlers may read cookies here.
      const userClient = await createServerSupabase()
      await executeJob(admin, userClient, dispatch.job)
    })
  }

  return success(publicJob(dispatch.job, { reused: !dispatch.run }), undefined, dispatch.job.status === 'completed' ? 200 : 202)
}

export const POST = apiHandler(postHandler)
