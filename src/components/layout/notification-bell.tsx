'use client'

import Link from 'next/link'
import { Bell, AlertTriangle, ShieldAlert, Info, Check, Undo2 } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useNotifications, NOTIFICATION_CATEGORY_LABELS } from '@/lib/hooks/use-notifications'
import type { NotificationRow, NotificationSeverity } from '@/lib/services/notifications'
import { timeAgo } from '@/lib/utils/date'
import { cn } from '@/lib/utils'

// 4.5. The inbox had a table, row-level security and an API, and no screen:
// zero rows were ever written, and nobody could have read one if they had.

/** Severity in words and shape, not only colour (C9). */
const SEVERITY: Record<NotificationSeverity, { Icon: typeof Info; className: string; label: string }> = {
  info: { Icon: Info, className: 'text-muted-foreground', label: 'Aviso' },
  warning: { Icon: AlertTriangle, className: 'text-warn', label: 'Atención' },
  critical: { Icon: ShieldAlert, className: 'text-loss', label: 'Importante' },
}

/** Where a notification leads, when it concerns something with a screen. */
function hrefFor(item: NotificationRow): string | null {
  if (item.kind.startsWith('price_alert:')) return '/alerts'
  if (item.category === 'system' && item.portfolio_id) return `/portfolio/${item.portfolio_id}/analytics`
  if (item.portfolio_id) return `/portfolio/${item.portfolio_id}`
  return null
}

function NotificationItem({ item, onToggle }: { item: NotificationRow; onToggle: (read: boolean) => void }) {
  const unread = item.read_at === null
  const severity = SEVERITY[item.severity] ?? SEVERITY.info
  const href = hrefFor(item)
  const title = <span className={cn('block text-sm leading-snug', unread && 'font-medium')}>{item.title}</span>

  return (
    <li className={cn('flex gap-2.5 rounded-lg p-2', unread ? 'bg-primary/5' : 'opacity-80')}>
      <severity.Icon aria-hidden="true" className={cn('mt-0.5 h-4 w-4 shrink-0', severity.className)} />
      <div className="min-w-0 flex-1 space-y-0.5">
        <span className="sr-only">{severity.label}{unread ? ', sin leer' : ''}: </span>
        {href ? (
          <Link href={href} className="hover:underline" onClick={() => unread && onToggle(true)}>
            {title}
          </Link>
        ) : (
          title
        )}
        {item.body && <p className="text-xs text-muted-foreground leading-relaxed">{item.body}</p>}
        <p className="text-[11px] text-muted-foreground">
          {NOTIFICATION_CATEGORY_LABELS[item.category] ?? item.category} · <time dateTime={item.created_at}>{timeAgo(item.created_at)}</time>
        </p>
      </div>
      <button
        type="button"
        onClick={() => onToggle(unread)}
        className="self-start rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
        aria-label={unread ? `Marcar como leída: ${item.title}` : `Marcar como no leída: ${item.title}`}
        title={unread ? 'Marcar como leída' : 'Marcar como no leída'}
      >
        {unread ? <Check aria-hidden="true" className="h-3.5 w-3.5" /> : <Undo2 aria-hidden="true" className="h-3.5 w-3.5" />}
      </button>
    </li>
  )
}

export function NotificationBell() {
  const { data, error, isLoading, setRead } = useNotifications()
  const unread = data?.unread ?? 0
  const items = data?.items ?? []
  const unreadIds = items.filter((item) => item.read_at === null).map((item) => item.id)
  const badge = unread > 9 ? '9+' : String(unread)

  return (
    <Popover>
      <PopoverTrigger
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        aria-label={unread > 0 ? `Notificaciones, ${unread} sin leer` : 'Notificaciones'}
      >
        <Bell aria-hidden="true" className="h-4 w-4" />
        {unread > 0 && (
          <span
            aria-hidden="true"
            className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground font-financial"
          >
            {badge}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-[min(92vw,380px)] gap-0 p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <p className="text-sm font-medium">Notificaciones</p>
          {unreadIds.length > 0 && (
            <button
              type="button"
              onClick={() => setRead(unreadIds, true)}
              className="text-xs text-primary hover:underline"
            >
              Marcar todas como leídas
            </button>
          )}
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-1.5">
          {isLoading ? (
            <p className="p-3 text-sm text-muted-foreground">Cargando…</p>
          ) : error ? (
            <p className="p-3 text-sm text-muted-foreground">No se pudieron cargar las notificaciones.</p>
          ) : items.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">
              Sin notificaciones. Aquí aparecen caídas y concentración de tus portafolios, movimientos fuera de lo normal,
              alertas de precio, datos que dejaron de actualizarse y cálculos en segundo plano que terminaron.
            </p>
          ) : (
            <ul className="space-y-1" aria-label="Notificaciones recientes">
              {items.map((item) => (
                <NotificationItem key={item.id} item={item} onToggle={(read) => setRead([item.id], read)} />
              ))}
            </ul>
          )}
        </div>

        <div className="border-t border-border px-3 py-2">
          <Link href="/settings/history" className="text-xs text-muted-foreground hover:text-foreground hover:underline">
            Ver historial de cambios
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  )
}
