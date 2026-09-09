import { describe, it, expect } from 'vitest'
import { diffForAudit, describeAuditEntry, type AuditRow } from '@/lib/services/audit'
import {
  drawdownNotification,
  outOfBandNotification,
  staleDataNotification,
  jobFinishedNotification,
} from '@/lib/services/notifications'

describe('diffForAudit', () => {
  it('finds the field that changed', () => {
    const changes = diffForAudit({ quantity: 100, price: 10 }, { quantity: 125, price: 10 }, [
      'quantity',
      'price',
    ])
    expect(changes).toEqual([{ field: 'quantity', oldValue: 100, newValue: 125 }])
  })

  it('finds nothing when nothing moved', () => {
    expect(diffForAudit({ a: 1 }, { a: 1 }, ['a'])).toEqual([])
  })

  it('ignores fields it was not asked about', () => {
    // Adding an internal column must not flood a user's history
    expect(diffForAudit({ a: 1, updated_at: 'x' }, { a: 1, updated_at: 'y' }, ['a'])).toEqual([])
  })

  it('does not report a re-submitted number as a change', () => {
    expect(diffForAudit({ quantity: 100 }, { quantity: '100' }, ['quantity'])).toEqual([])
  })

  it('treats a real numeric change as a change even at the same string length', () => {
    expect(diffForAudit({ q: 100 }, { q: 200 }, ['q'])).toHaveLength(1)
  })

  it('handles a field appearing or disappearing', () => {
    expect(diffForAudit({ a: 1 }, { a: 1, b: 2 }, ['b'])).toHaveLength(1)
    expect(diffForAudit({ b: 2 }, {}, ['b'])).toHaveLength(1)
  })

  it('returns nothing when either side is missing', () => {
    expect(diffForAudit(null, { a: 1 }, ['a'])).toEqual([])
    expect(diffForAudit({ a: 1 }, undefined, ['a'])).toEqual([])
  })
})

describe('describeAuditEntry', () => {
  const row = (patch: Partial<AuditRow>): AuditRow => ({
    id: '1',
    entity_type: 'position',
    entity_id: 'AAPL',
    action: 'updated',
    field: 'quantity',
    old_value: '100',
    new_value: '125',
    created_at: '2026-09-09T00:00:00Z',
    ...patch,
  })

  it('reads an update as a before and after', () => {
    expect(describeAuditEntry(row({}))).toBe(
      'Changed quantity on position AAPL from 100 to 125.',
    )
  })

  it('reads a creation and a deletion', () => {
    expect(describeAuditEntry(row({ action: 'created', field: null }))).toMatch(/^Created/)
    expect(describeAuditEntry(row({ action: 'deleted', field: null }))).toMatch(/^Deleted/)
  })

  it('says "empty" rather than leaving a blank where a value should be', () => {
    expect(describeAuditEntry(row({ old_value: null }))).toContain('from empty')
  })
})

describe('notification builders', () => {
  it('stays quiet about a drawdown too shallow to be news', () => {
    expect(drawdownNotification('u', 'p', 4, 4.2)).toBeNull()
  })

  it('warns about a meaningful drawdown and escalates a deep one', () => {
    expect(drawdownNotification('u', 'p', 12, 13.6)!.severity).toBe('warning')
    expect(drawdownNotification('u', 'p', 35, 53.8)!.severity).toBe('critical')
  })

  it('explains why recovering takes more than the fall', () => {
    const n = drawdownNotification('u', 'p', 23, 29.9)!
    expect(n.body).toMatch(/smaller balance/)
    expect(n.body).toContain('29.9%')
  })

  it('handles a missing recovery figure without printing null', () => {
    const n = drawdownNotification('u', 'p', 100, null)!
    expect(n.body).not.toMatch(/null/)
  })

  it('keys an out-of-band alert per symbol so two holdings can both fire', () => {
    const a = outOfBandNotification('u', 'p', 'AAPL', 36.3, 30, 5)
    const b = outOfBandNotification('u', 'p', 'MSFT', 24.1, 30, 5)
    expect(a.kind).not.toBe(b.kind)
    expect(a.title).toContain('AAPL')
  })

  it('escalates a stale price once it is more than a week old', () => {
    expect(staleDataNotification('u', 'AAPL', 3).severity).toBe('warning')
    expect(staleDataNotification('u', 'AAPL', 20).severity).toBe('critical')
  })

  it('reports a finished job and a failed one differently', () => {
    const done = jobFinishedNotification('u', 'p', 'montecarlo', true)
    const failed = jobFinishedNotification('u', 'p', 'montecarlo', false)
    expect(done.severity).toBe('info')
    expect(failed.severity).toBe('warning')
    expect(done.kind).not.toBe(failed.kind)
    expect(failed.body).toMatch(/Nothing was saved/)
  })

  it('gives every builder a category the inbox can group by', () => {
    expect(drawdownNotification('u', 'p', 15, 17.6)!.category).toBe('portfolio')
    expect(outOfBandNotification('u', 'p', 'A', 40, 30, 5).category).toBe('portfolio')
    expect(staleDataNotification('u', 'A', 10).category).toBe('data')
    expect(jobFinishedNotification('u', null, 'backtest', true).category).toBe('system')
  })
})
