// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { isAuthorizedCronRequest } from '@/lib/api/cron-auth'

const SECRET = 'a-cron-secret-long-enough-0123456789'

describe('isAuthorizedCronRequest', () => {
  it('accepts the exact bearer token', () => {
    expect(isAuthorizedCronRequest(`Bearer ${SECRET}`, SECRET)).toBe(true)
  })

  it('fails closed when the secret is not configured — the old check let everyone in', () => {
    expect(isAuthorizedCronRequest(null, undefined)).toBe(false)
    expect(isAuthorizedCronRequest('Bearer anything', undefined)).toBe(false)
    expect(isAuthorizedCronRequest('Bearer ', '')).toBe(false)
  })

  it('rejects a missing, wrong, truncated or differently cased header', () => {
    expect(isAuthorizedCronRequest(null, SECRET)).toBe(false)
    expect(isAuthorizedCronRequest(`Bearer ${SECRET}x`, SECRET)).toBe(false)
    expect(isAuthorizedCronRequest(`Bearer ${SECRET.slice(0, -1)}`, SECRET)).toBe(false)
    expect(isAuthorizedCronRequest(`bearer ${SECRET}`, SECRET)).toBe(false)
    expect(isAuthorizedCronRequest(SECRET, SECRET)).toBe(false)
  })
})
