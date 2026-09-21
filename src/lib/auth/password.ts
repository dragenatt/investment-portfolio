// Rules and messages shared by every form that sets a password: register,
// the reset page reached from a recovery link, and Settings.

/** Supabase Auth's own minimum; the register form has always used it. */
export const MIN_PASSWORD_LENGTH = 6

export type PasswordProblem = 'too_short' | 'mismatch'

/** Why a new password cannot be submitted yet, or null when it can. */
export function newPasswordProblem(password: string, confirmation: string): PasswordProblem | null {
  if (password.length < MIN_PASSWORD_LENGTH) return 'too_short'
  if (password !== confirmation) return 'mismatch'
  return null
}

export type AuthProblem =
  | 'same_password'
  | 'weak_password'
  | 'rate_limited'
  | 'wrong_password'
  | 'email_exists'
  | 'session_missing'
  | 'unknown'

/**
 * Supabase's error for a password or email change, in the terms the form
 * explains it in. `code` is the stable field; the message text is a fallback
 * for errors raised before the API had codes.
 */
export function authProblem(error: { code?: string; message?: string; status?: number } | null | undefined): AuthProblem {
  const code = error?.code ?? ''
  const message = (error?.message ?? '').toLowerCase()
  if (code === 'same_password' || message.includes('different from the old password')) return 'same_password'
  if (code === 'weak_password' || message.includes('weak') || message.includes('pwned')) return 'weak_password'
  if (code.startsWith('over_') || error?.status === 429) return 'rate_limited'
  if (code === 'invalid_credentials' || message.includes('invalid login credentials')) return 'wrong_password'
  if (code === 'email_exists' || message.includes('already been registered')) return 'email_exists'
  if (code === 'session_not_found' || code === 'session_expired' || message.includes('session missing')) return 'session_missing'
  return 'unknown'
}
