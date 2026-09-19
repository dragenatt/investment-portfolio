import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { apiHandler } from '@/lib/api/handler'
import { recordFunnelEvent } from '@/lib/analytics/funnel'
import { FUNNEL_EVENTS, isFunnelEvent, type FunnelEvent } from '@/lib/analytics/events'

/**
 * Steps the browser is allowed to report, because they happen in the browser and
 * nowhere else. Everything else is recorded server-side at the point it actually
 * occurs, so a client cannot inflate a step it never reached.
 */
const CLIENT_REPORTABLE: FunnelEvent[] = [
  // "cuenta_creada" was here and is not any more: the browser could only report
  // it when signUp returned a session, which with email confirmation on it does
  // not, so the step went uncounted. The signup trigger records it (025).
  FUNNEL_EVENTS.FIRST_MONTE_CARLO,
]

async function postHandler(req: Request) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return error('Invalid JSON', 400)
  }

  const event = (body as { event?: unknown } | null)?.event
  if (!isFunnelEvent(event) || !CLIENT_REPORTABLE.includes(event)) {
    return error('Unknown event', 400)
  }

  // The identity comes from the session, never from the body: the client says
  // what happened, not who it happened to.
  await recordFunnelEvent(event, user.id)

  return success({ recorded: event })
}

export const POST = apiHandler(postHandler)
