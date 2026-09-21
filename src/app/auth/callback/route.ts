import { NextResponse } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'
import { createServerSupabase } from '@/lib/supabase/server'
import { safeNextPath } from '@/lib/utils/safe-redirect'

/**
 * Where the links Supabase emails come back to: password recovery, sign-up
 * confirmation, email change.
 *
 * None of them worked before this route existed. A recovery link needs its
 * one-time code exchanged for a session before anyone can choose a password,
 * and nothing in the app did that exchange — so there was no way back into an
 * account whose password was forgotten.
 *
 * Two link formats are accepted:
 *   ?code=…                   the PKCE flow @supabase/ssr uses by default. The
 *                             exchange needs the verifier cookie set when the
 *                             link was requested, so it only succeeds in that
 *                             same browser — the forms say so.
 *   ?token_hash=…&type=…      the format of Supabase's recommended email
 *                             templates, if the project switches to them.
 *
 * A failed or expired link goes to /login with a message rather than an error
 * page: that is where the person can ask for another one.
 */

const RESET_PAGE = '/reset-password'
const OTP_TYPES: readonly EmailOtpType[] = ['signup', 'invite', 'magiclink', 'recovery', 'email_change', 'email']

function isOtpType(value: string | null): value is EmailOtpType {
  return value !== null && (OTP_TYPES as readonly string[]).includes(value)
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  // Only a path on this origin, never /login or /register (safe-redirect.ts).
  const next = safeNextPath(url.searchParams.get('next'))
  const code = url.searchParams.get('code')
  const tokenHash = url.searchParams.get('token_hash')
  const type = url.searchParams.get('type')
  const to = (path: string) => NextResponse.redirect(new URL(path, url.origin))

  try {
    const supabase = await createServerSupabase()

    if (code) {
      const { data, error } = await supabase.auth.exchangeCodeForSession(code)
      if (!error) {
        // auth-js returns how the code was requested (GoTrueClient: the
        // verifier is stored with "/PASSWORD_RECOVERY" by resetPasswordForEmail)
        // but does not declare it in its types. A recovery link that lost its
        // `next` — Supabase falls back to the Site URL when a redirect is not
        // allow-listed — still lands on the page that sets the password.
        const redirectType = (data as { redirectType?: string | null }).redirectType
        return to(redirectType === 'PASSWORD_RECOVERY' ? RESET_PAGE : next)
      }
    } else if (tokenHash && isOtpType(type)) {
      const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash })
      if (!error) return to(type === 'recovery' ? RESET_PAGE : next)
    }
  } catch (err) {
    console.error('[auth/callback] could not complete the link:', err)
  }

  return to('/login?error=link')
}
