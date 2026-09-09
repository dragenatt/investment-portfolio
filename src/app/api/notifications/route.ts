import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { apiHandler } from '@/lib/api/handler'
import { listNotifications, markRead, unreadCount } from '@/lib/services/notifications'

/**
 * The signed-in user's notification inbox.
 *
 * RLS scopes every row to its owner, so there is no user filter here to get
 * wrong. The unread count comes back with the list because every caller that
 * wants the list also wants the badge.
 */
async function getHandler(req: Request) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const url = new URL(req.url)
  const unreadOnly = url.searchParams.get('unread') === 'true'
  const limit = Number(url.searchParams.get('limit') ?? 50)

  const [items, unread] = await Promise.all([
    listNotifications(supabase, { unreadOnly, limit: Number.isFinite(limit) ? limit : 50 }),
    unreadCount(supabase),
  ])

  return success({ items, unread })
}

/** Mark notifications read or unread. Body: `{ ids: string[], read?: boolean }`. */
async function patchHandler(req: Request) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return error('Invalid JSON', 400)
  }

  const { ids, read } = (body ?? {}) as { ids?: unknown; read?: unknown }
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) {
    return error('ids must be an array of notification ids', 400)
  }
  if (ids.length > 200) return error('Too many ids in one request', 400)

  const updated = await markRead(supabase, ids as string[], read !== false)
  return success({ updated, unread: await unreadCount(supabase) })
}

export const GET = apiHandler(getHandler)
export const PATCH = apiHandler(patchHandler)
