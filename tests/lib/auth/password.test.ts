import { describe, it, expect } from 'vitest'
import { authProblem, newPasswordProblem, MIN_PASSWORD_LENGTH } from '@/lib/auth/password'

describe('newPasswordProblem', () => {
  it('asks for the minimum Supabase itself enforces', () => {
    const short = 'x'.repeat(MIN_PASSWORD_LENGTH - 1)
    expect(newPasswordProblem(short, short)).toBe('too_short')
  })

  it('refuses two passwords that differ', () => {
    expect(newPasswordProblem('abcdef1', 'abcdef2')).toBe('mismatch')
  })

  it('accepts a long enough password typed the same twice', () => {
    expect(newPasswordProblem('abcdef1', 'abcdef1')).toBeNull()
  })
})

describe('authProblem', () => {
  it('reads the stable error codes', () => {
    expect(authProblem({ code: 'same_password' })).toBe('same_password')
    expect(authProblem({ code: 'weak_password' })).toBe('weak_password')
    expect(authProblem({ code: 'over_email_send_rate_limit', status: 429 })).toBe('rate_limited')
    expect(authProblem({ code: 'invalid_credentials', status: 400 })).toBe('wrong_password')
    expect(authProblem({ code: 'email_exists' })).toBe('email_exists')
  })

  it('falls back to the message for errors without a code', () => {
    expect(authProblem({ message: 'Invalid login credentials' })).toBe('wrong_password')
    expect(authProblem({ message: 'Auth session missing!' })).toBe('session_missing')
  })

  it('does not guess at anything else', () => {
    expect(authProblem({ message: 'Something odd' })).toBe('unknown')
    expect(authProblem(null)).toBe('unknown')
  })
})
