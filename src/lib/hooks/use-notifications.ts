import useSWR from 'swr'
import { useCallback } from 'react'
import { apiFetcher } from '@/lib/api/fetcher'
import type { NotificationCategory, NotificationRow } from '@/lib/services/notifications'
import type { AuditEntityType, AuditRow } from '@/lib/services/audit-labels'

export type NotificationInbox = { items: NotificationRow[]; unread: number }

/** Checked every two minutes: the producers are a nightly job and finished calculations, not a feed. */
const INBOX_REFRESH_MS = 2 * 60 * 1000

export const NOTIFICATION_CATEGORY_LABELS: Record<NotificationCategory, string> = {
  portfolio: 'Portafolio',
  market: 'Mercado',
  data: 'Datos',
  system: 'Sistema',
}

export function useNotifications() {
  const swr = useSWR<NotificationInbox>('/api/notifications?limit=30', apiFetcher, {
    refreshInterval: INBOX_REFRESH_MS,
    revalidateOnFocus: true,
  })
  const { mutate } = swr

  /**
   * Mark notifications read or unread. The badge moves at once; the server's
   * answer replaces the guess, and a failure puts the old state back.
   */
  const setRead = useCallback(
    async (ids: string[], read: boolean) => {
      if (ids.length === 0) return
      const stamp = read ? new Date().toISOString() : null
      await mutate(
        async (current) => {
          const res = await fetch('/api/notifications', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids, read }),
          })
          const body = await res.json()
          if (!res.ok || body.error) throw new Error(body.error ?? 'No se pudo actualizar')
          if (!current) return current
          return {
            unread: body.data.unread,
            items: current.items.map((item) => (ids.includes(item.id) ? { ...item, read_at: stamp } : item)),
          }
        },
        {
          optimisticData: (current) =>
            current
              ? {
                  items: current.items.map((item) => (ids.includes(item.id) ? { ...item, read_at: stamp } : item)),
                  unread: Math.max(
                    0,
                    current.unread +
                      current.items.filter((item) => ids.includes(item.id) && (item.read_at === null) === read).length *
                        (read ? -1 : 1),
                  ),
                }
              : { items: [], unread: 0 },
          rollbackOnError: true,
          revalidate: false,
        },
      )
    },
    [mutate],
  )

  return { ...swr, setRead }
}

export type AuditTrailRow = AuditRow & { description: string }

export function useAuditTrail(filters: { entityType?: AuditEntityType; portfolioId?: string } = {}) {
  const params = new URLSearchParams({ limit: '200' })
  if (filters.entityType) params.set('entity_type', filters.entityType)
  if (filters.portfolioId) params.set('portfolio_id', filters.portfolioId)
  return useSWR<AuditTrailRow[]>(`/api/audit?${params.toString()}`, apiFetcher)
}
