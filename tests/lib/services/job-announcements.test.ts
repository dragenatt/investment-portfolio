import { describe, it, expect } from 'vitest'
import { successIsNews, ANNOUNCE_SUCCESS_AFTER_MS } from '@/lib/jobs/runner'

// Opening Analysis ran three jobs that each finished in seconds and each put a
// "terminó" notification in the inbox for results already on screen.

describe('job success announcements', () => {
  const created = '2026-09-19T05:26:00.000Z'
  const t0 = Date.parse(created)

  it('stays quiet about a job that finished while its page was open', () => {
    expect(successIsNews(created, t0 + 4_000)).toBe(false)
  })

  it('announces one that ran long enough to have outlived the tab', () => {
    expect(successIsNews(created, t0 + ANNOUNCE_SUCCESS_AFTER_MS)).toBe(true)
    expect(successIsNews(created, t0 + 5 * 60_000)).toBe(true)
  })

  it('does not announce on a timestamp it cannot read', () => {
    expect(successIsNews('not a date', t0)).toBe(false)
  })
})
