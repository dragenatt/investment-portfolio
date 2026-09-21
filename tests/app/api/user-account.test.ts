import { describe, it, expect, vi, beforeEach } from 'vitest'

// There was no way to close an account. DELETE /api/user/account deletes the
// Auth user — every table cascades from it — after checking the password
// again with a client that has no cookies.

const session = vi.hoisted(() => ({ getUser: vi.fn() }))
const verifier = vi.hoisted(() => ({ signInWithPassword: vi.fn() }))
const admin = vi.hoisted(() => ({ deleteUser: vi.fn(), available: true }))
const jar = vi.hoisted(() => ({ cookies: [] as Array<{ name: string }>, deleted: [] as string[] }))

vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: async () => ({ auth: session }) }))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth: verifier }) }))
vi.mock('@/lib/supabase/admin', () => ({
  serviceRoleClient: () => (admin.available ? { auth: { admin: { deleteUser: admin.deleteUser } } } : null),
}))
vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => jar.cookies, delete: (name: string) => jar.deleted.push(name) }),
}))
vi.mock('@/lib/api/rate-limit', () => ({ rateLimit: async () => true }))

const { DELETE } = await import('@/app/api/user/account/route')

const USER = { id: 'user-1', email: 'someone@example.com' }

function call(body: unknown) {
  return DELETE(
    new Request('https://app.example/api/user/account', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

beforeEach(() => {
  session.getUser.mockReset().mockResolvedValue({ data: { user: USER } })
  verifier.signInWithPassword.mockReset()
  admin.deleteUser.mockReset().mockResolvedValue({ error: null })
  admin.available = true
  jar.cookies = [{ name: 'sb-ref-auth-token.0' }, { name: 'sb-ref-auth-token.1' }, { name: 'NEXT_LOCALE' }]
  jar.deleted = []
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('DELETE /api/user/account', () => {
  it('deletes the account after the password checks out, and drops its session cookies', async () => {
    verifier.signInWithPassword.mockResolvedValue({ data: { user: { id: USER.id } }, error: null })

    const response = await call({ password: 'right' })

    expect(response.status).toBe(200)
    expect(verifier.signInWithPassword).toHaveBeenCalledWith({ email: USER.email, password: 'right' })
    expect(admin.deleteUser).toHaveBeenCalledWith(USER.id)
    expect(jar.deleted).toEqual(['sb-ref-auth-token.0', 'sb-ref-auth-token.1'])
  })

  it('deletes nothing on a wrong password', async () => {
    verifier.signInWithPassword.mockResolvedValue({ data: { user: null }, error: { code: 'invalid_credentials' } })

    const response = await call({ password: 'wrong' })

    expect(response.status).toBe(403)
    expect(admin.deleteUser).not.toHaveBeenCalled()
    expect(jar.deleted).toEqual([])
  })

  it('deletes nothing when the password belongs to a different user', async () => {
    verifier.signInWithPassword.mockResolvedValue({ data: { user: { id: 'someone-else' } }, error: null })

    expect((await call({ password: 'theirs' })).status).toBe(403)
    expect(admin.deleteUser).not.toHaveBeenCalled()
  })

  it('refuses without a session or without a password', async () => {
    expect((await call({})).status).toBe(400)

    session.getUser.mockResolvedValue({ data: { user: null } })
    expect((await call({ password: 'x' })).status).toBe(401)
    expect(admin.deleteUser).not.toHaveBeenCalled()
  })

  it('says it cannot, rather than pretending, where the service role is not configured', async () => {
    verifier.signInWithPassword.mockResolvedValue({ data: { user: { id: USER.id } }, error: null })
    admin.available = false

    expect((await call({ password: 'right' })).status).toBe(503)
  })

  it('keeps the session when Supabase fails to delete', async () => {
    verifier.signInWithPassword.mockResolvedValue({ data: { user: { id: USER.id } }, error: null })
    admin.deleteUser.mockResolvedValue({ error: { message: 'Database error deleting user' } })

    expect((await call({ password: 'right' })).status).toBe(500)
    expect(jar.deleted).toEqual([])
  })
})
