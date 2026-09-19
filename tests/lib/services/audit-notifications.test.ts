import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  diffForAudit,
  describeAuditEntry,
  auditRows,
  writeAudit,
  describeTrade,
  positionChangeEntries,
  type AuditRow,
} from '@/lib/services/audit'
import {
  drawdownNotification,
  outOfBandNotification,
  staleDataNotification,
  jobFinishedNotification,
  concentrationNotification,
  extraordinaryMoveNotification,
  priceAlertNotification,
  withoutRepeats,
  deliverNotifications,
  type NotificationInput,
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

  it('reads an update as a before and after, in the reader\'s words', () => {
    expect(describeAuditEntry(row({}))).toBe('Cambió cantidad de la posición AAPL: 100 → 125.')
  })

  it('names the entity by its stored label, not its id', () => {
    expect(describeAuditEntry(row({ entity_id: '3f2a9c', entity_label: 'MSFT' }))).toContain('la posición MSFT')
  })

  it('reads a creation and a deletion', () => {
    expect(describeAuditEntry(row({ action: 'created', field: null }))).toMatch(/^Creó la posición/)
    expect(describeAuditEntry(row({ action: 'deleted', field: null }))).toMatch(/^Eliminó la posición/)
  })

  it('says "vacío" rather than leaving a blank where a value should be', () => {
    expect(describeAuditEntry(row({ old_value: null }))).toContain('vacío →')
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
    expect(n.body).toMatch(/saldo menor/)
    expect(n.body).toContain('29.9%')
  })

  it('says which drawdown it measured, so it cannot be mistaken for the value chart\'s', () => {
    const n = drawdownNotification('u', 'p', 12, 13.6, 'Retiro')!
    expect(n.title).toContain('Retiro')
    expect(n.details).toMatchObject({ method: 'currentWeights' })
    expect(n.body).toMatch(/posiciones que tiene hoy/)
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
    expect(failed.body).toMatch(/No se guardó nada/)
  })

  it('keys a concentration finding by what is concentrated', () => {
    const a = concentrationNotification('u', 'p', { alert_type: 'position_concentration', severity: 'critical', message: 'AAPL representa 45.0% de tu portafolio', details: { symbol: 'AAPL', weight: 0.45 } })
    const b = concentrationNotification('u', 'p', { alert_type: 'sector_concentration', severity: 'warning', message: 'El sector Technology es 60.0% de tu portafolio', details: { sector: 'Technology', weight: 0.6 } })
    expect(a.kind).toBe('concentration:position_concentration:AAPL')
    expect(b.kind).toBe('concentration:sector_concentration:Technology')
    expect(a.severity).toBe('critical')
  })

  it('describes an extraordinary move by its size against the asset\'s own range', () => {
    const n = extraordinaryMoveNotification('u', 'p', { symbol: 'NVDA', date: '2026-09-15', returnPct: -8.4, zScore: -4.2 })
    expect(n.title).toBe('NVDA cayó 8.4% el 2026-09-15')
    expect(n.body).toContain('4.2 veces')
    expect(n.category).toBe('market')
    expect(n.severity).toBe('warning')
    expect(extraordinaryMoveNotification('u', 'p', { symbol: 'X', date: 'd', returnPct: 20, zScore: 6 }).severity).toBe('critical')
  })

  it('says a fired price alert was switched off, and keys it by the alert', () => {
    const n = priceAlertNotification('u', { id: 'a1', symbol: 'AAPL', condition: 'above', target: 250 }, { price: 251.3, changePct: 1.2 })
    expect(n.kind).toBe('price_alert:a1')
    expect(n.body).toContain('por encima de 250')
    expect(n.body).toMatch(/desactivada/)
  })

  it('gives every builder a category the inbox can group by', () => {
    expect(drawdownNotification('u', 'p', 15, 17.6)!.category).toBe('portfolio')
    expect(outOfBandNotification('u', 'p', 'A', 40, 30, 5).category).toBe('portfolio')
    expect(staleDataNotification('u', 'A', 10).category).toBe('data')
    expect(jobFinishedNotification('u', null, 'backtest', true).category).toBe('system')
  })
})

describe('audit writing', () => {
  it('maps entries to rows with their portfolio and label', () => {
    const [row] = auditRows([{ userId: 'u', entityType: 'position', entityId: 'pos-1', portfolioId: 'p', label: 'AAPL', action: 'updated', field: 'quantity', oldValue: 10, newValue: 12 }])
    expect(row).toEqual({
      user_id: 'u', entity_type: 'position', entity_id: 'pos-1', portfolio_id: 'p', entity_label: 'AAPL',
      action: 'updated', field: 'quantity', old_value: '10', new_value: '12',
    })
  })

  it('writes every entry in one insert through the writer it is given', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null })
    const writer = { from: vi.fn(() => ({ insert })) } as unknown as SupabaseClient
    const written = await writeAudit(
      [
        { userId: 'u', entityType: 'goal', action: 'created', label: 'Casa' },
        { userId: 'u', entityType: 'goal', action: 'deleted', label: 'Casa' },
      ],
      writer,
    )
    expect(written).toBe(2)
    expect(insert).toHaveBeenCalledTimes(1)
    expect(insert.mock.calls[0][0]).toHaveLength(2)
  })

  it('never throws, and reports nothing written, when the insert is refused', async () => {
    const insert = vi.fn().mockResolvedValue({ error: { message: 'new row violates row-level security policy' } })
    const writer = { from: vi.fn(() => ({ insert })) } as unknown as SupabaseClient
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(writeAudit([{ userId: 'u', entityType: 'goal', action: 'created' }], writer)).resolves.toBe(0)
    await expect(writeAudit([{ userId: 'u', entityType: 'goal', action: 'created' }], null)).resolves.toBe(0)
    spy.mockRestore()
  })

  it('names a trade the way the history reads it', () => {
    expect(describeTrade({ type: 'sell', quantity: 3, symbol: 'VOO', price: 512.4, currency: 'USD' })).toBe('venta 3 VOO a 512.4 USD')
  })

  it('records what a trade did to the position, without float noise', () => {
    const entries = positionChangeEntries(
      { userId: 'u', positionId: 'pos', portfolioId: 'p', symbol: 'AAPL' },
      { quantity: 10, avg_cost: 150 },
      { quantity: 15, avg_cost: 150.33333333333334 },
    )
    expect(entries.map((e) => [e.field, e.oldValue, e.newValue])).toEqual([
      ['quantity', 10, 15],
      ['avg_cost', 150, 150.333333],
    ])
    expect(entries.every((e) => e.label === 'AAPL' && e.portfolioId === 'p')).toBe(true)
  })

  it('records nothing for a position the trade did not change', () => {
    // A dividend leaves quantity and average cost where they were.
    expect(positionChangeEntries({ userId: 'u', positionId: 'x', portfolioId: 'p', symbol: 'A' }, { quantity: '5', avg_cost: '20' }, { quantity: 5, avg_cost: 20 })).toEqual([])
  })
})

describe('notification delivery', () => {
  const input = (kind: string, portfolioId: string | null = 'p'): NotificationInput => ({
    userId: 'u', portfolioId, category: 'portfolio', kind, title: kind,
  })

  it('does not repeat a notification whose twin went out this week, read or not', () => {
    const kept = withoutRepeats(
      [input('drawdown'), input('concentration:x'), input('drawdown', 'other')],
      [{ user_id: 'u', portfolio_id: 'p', kind: 'drawdown' }],
    )
    expect(kept.map((n) => `${n.kind}@${n.portfolioId}`)).toEqual(['concentration:x@p', 'drawdown@other'])
  })

  it('sends one of two identical inputs from the same run', () => {
    expect(withoutRepeats([input('stale_price:A', null), input('stale_price:A', null)], [])).toHaveLength(1)
  })

  it('counts today\'s duplicate as suppressed, not failed, and keeps delivering the rest', async () => {
    const inserts: unknown[] = []
    const writer = {
      from: vi.fn(() => ({
        select: () => ({ in: () => ({ gte: async () => ({ data: [{ user_id: 'u', portfolio_id: 'p', kind: 'waiting' }] }) }) }),
        insert: vi.fn(async (row: { kind: string }) => {
          inserts.push(row)
          return { error: row.kind === 'dup' ? { code: '23505', message: 'duplicate' } : null }
        }),
      })),
    } as unknown as SupabaseClient

    const result = await deliverNotifications([input('waiting'), input('dup'), input('new')], { writer })
    expect(result).toEqual({ delivered: 1, suppressed: 2, failed: 0 })
    expect(inserts).toHaveLength(2)
  })
})
