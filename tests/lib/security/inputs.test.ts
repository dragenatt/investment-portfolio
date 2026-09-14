// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest'
import { UpdateProfileSchema } from '@/lib/schemas/user'
import { RenameWatchlistSchema } from '@/lib/schemas/watchlist-manage'
import { error, GENERIC_SERVER_ERROR } from '@/lib/api/response'

afterEach(() => vi.restoreAllMocks())

describe('UpdateProfileSchema', () => {
  it('keeps the fields the profile page sends instead of silently dropping them', () => {
    const parsed = UpdateProfileSchema.parse({
      username: ' Angello_1 ',
      bio: 'Invierto a largo plazo',
      location: 'CDMX',
      website: 'https://example.com',
    })
    expect(parsed).toEqual({
      username: 'angello_1',
      bio: 'Invierto a largo plazo',
      location: 'CDMX',
      website: 'https://example.com',
    })
  })

  it('refuses javascript: and other non-http links, which would run when clicked', () => {
    for (const website of ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'ftp://example.com']) {
      expect(UpdateProfileSchema.safeParse({ website }).success, website).toBe(false)
    }
    expect(UpdateProfileSchema.safeParse({ avatar_url: 'javascript:alert(1)' }).success).toBe(false)
  })

  it('clears the website with an empty field', () => {
    expect(UpdateProfileSchema.parse({ website: '' })).toEqual({ website: null })
  })

  it('rejects usernames that are not 3-30 letters, digits or underscores', () => {
    for (const username of ['ab', 'a'.repeat(31), 'con espacio', 'ñandú', '<script>']) {
      expect(UpdateProfileSchema.safeParse({ username }).success, username).toBe(false)
    }
  })

  it('never passes through columns the user must not set', () => {
    const parsed = UpdateProfileSchema.parse({ bio: 'x', is_verified: true, follower_count: 1e6, user_id: 'someone' })
    expect(parsed).toEqual({ bio: 'x' })
  })

  it('caps lengths', () => {
    expect(UpdateProfileSchema.safeParse({ bio: 'x'.repeat(301) }).success).toBe(false)
    expect(UpdateProfileSchema.safeParse({ location: 'x'.repeat(51) }).success).toBe(false)
  })
})

describe('RenameWatchlistSchema', () => {
  it('lets only the name through — the route used to update with the raw body', () => {
    expect(RenameWatchlistSchema.parse({ name: '  Tech  ', user_id: 'other-user', id: 'x' })).toEqual({ name: 'Tech' })
    expect(RenameWatchlistSchema.safeParse({ name: '   ' }).success).toBe(false)
  })
})

describe('error()', () => {
  it('hides the message of a 500 and logs it instead', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const response = error('duplicate key value violates unique constraint "profiles_username_key"', 500)
    expect(await response.json()).toEqual({ data: null, error: GENERIC_SERVER_ERROR })
    expect(response.status).toBe(500)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('profiles_username_key'))
  })

  it('keeps messages written for users on 4xx and 503', async () => {
    expect((await error('Portafolio no encontrado.', 404).json()).error).toBe('Portafolio no encontrado.')
    expect((await error('No disponible en este entorno.', 503).json()).error).toBe('No disponible en este entorno.')
  })
})
