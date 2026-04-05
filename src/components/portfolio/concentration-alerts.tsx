'use client'

import { useState } from 'react'
import { AlertTriangle, ShieldAlert, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'

type Alert = {
  id: string
  alert_type: string
  severity: 'warning' | 'critical'
  message: string
  metadata: Record<string, unknown>
  created_at: string
}

type Props = {
  alerts: Alert[]
  onDismiss: (alertId: string) => void
  isLoading?: boolean
}

const severityConfig = {
  warning: {
    icon: AlertTriangle,
    border: '1px solid color-mix(in srgb, #f59e0b 40%, transparent)',
    bg: 'color-mix(in srgb, #f59e0b 5%, transparent)',
    iconClass: 'text-amber-500',
  },
  critical: {
    icon: ShieldAlert,
    border: '1px solid color-mix(in srgb, var(--bad) 40%, transparent)',
    bg: 'color-mix(in srgb, var(--bad) 5%, transparent)',
    iconClass: 'text-[var(--bad)]',
  },
} as const

function AlertSkeleton() {
  return (
    <div className="flex items-center gap-3 rounded-xl px-4 py-3 border border-border">
      <Skeleton className="h-5 w-5 shrink-0 rounded-full" />
      <Skeleton className="h-4 flex-1" />
      <Skeleton className="h-5 w-5 shrink-0 rounded-full" />
    </div>
  )
}

export function ConcentrationAlerts({ alerts, onDismiss, isLoading }: Props) {
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set())

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2">
        <AlertSkeleton />
        <AlertSkeleton />
      </div>
    )
  }

  const visibleAlerts = alerts.filter((a) => !dismissedIds.has(a.id))

  if (visibleAlerts.length === 0) return null

  function handleDismiss(alertId: string) {
    setDismissedIds((prev) => new Set(prev).add(alertId))
    onDismiss(alertId)
  }

  return (
    <div className="flex flex-col gap-2">
      {visibleAlerts.map((alert) => {
        const config = severityConfig[alert.severity]
        const Icon = config.icon

        return (
          <div
            key={alert.id}
            className="flex items-center gap-3 rounded-xl px-4 py-3 animate-in fade-in slide-in-from-top-2 duration-300"
            style={{
              border: config.border,
              background: config.bg,
            }}
          >
            <Icon className={cn('h-5 w-5 shrink-0', config.iconClass)} />
            <p className="flex-1 text-sm font-medium text-[var(--muted-foreground)]">
              {alert.message}
            </p>
            <button
              type="button"
              onClick={() => handleDismiss(alert.id)}
              className="shrink-0 rounded-md p-1 opacity-60 transition-opacity hover:opacity-100"
              aria-label="Dismiss alert"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
