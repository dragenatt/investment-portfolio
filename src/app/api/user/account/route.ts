import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'
import { serviceRoleClient } from '@/lib/supabase/admin'
import { success, error } from '@/lib/api/response'
import { rateLimit } from '@/lib/api/rate-limit'
import { apiHandler } from '@/lib/api/handler'

/**
 * DELETE /api/user/account — the account and everything in it, for good.
 *
 * There was no way to do this. Every table that holds a user's data references
 * auth.users with ON DELETE CASCADE (checked against production on 2026-09-21:
 * portfolios and through them positions, transactions and snapshots; goals,
 * alerts, watchlists, notifications, the audit log, follows, likes, shares,
 * the profile), and none keeps a user_id without that reference, so deleting
 * the Auth user deletes the rest. Only the service role may delete one.
 *
 * The password is checked again here, on a client with no cookies, rather than
 * trusting the session: a session proves someone is at a signed-in browser,
 * not that it is the account holder.
 */

const BodySchema = z.object({ password: z.string().min(1).max(200) })

function isAuthCookie(name: string): boolean {
  return name.startsWith('sb-') && name.includes('-auth-token')
}

async function deleteHandler(req: Request) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return error('Unauthorized', 401)

  const allowed = await rateLimit(user.id, 'transaction')
  if (!allowed) return error('Demasiadas solicitudes, intenta más tarde', 429)

  const parsed = BodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return error('Falta la contraseña', 400)

  const verifier = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: check, error: checkError } = await verifier.auth.signInWithPassword({
    email: user.email,
    password: parsed.data.password,
  })
  if (checkError || check.user?.id !== user.id) return error('La contraseña no es correcta', 403)

  const admin = serviceRoleClient()
  if (!admin) return error('La eliminación de cuentas no está disponible en este entorno', 503)

  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id)
  if (deleteError) {
    console.error('[account] could not delete a user:', deleteError.message)
    return error('No se pudo eliminar la cuenta', 500)
  }

  // The session in this browser belongs to a user that no longer exists.
  const store = await cookies()
  for (const cookie of store.getAll()) {
    if (isAuthCookie(cookie.name)) store.delete(cookie.name)
  }

  return success({ deleted: true })
}

export const DELETE = apiHandler(deleteHandler)
