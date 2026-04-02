'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ErrorDisplay } from '@/components/shared/error-display'
import { Bell, Trash2, Power } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CreateAlertModal } from '@/components/alerts/create-alert-modal'
import useSWR from 'swr'
import { toast } from 'sonner'
import { useState } from 'react'
import { useTranslation } from '@/lib/i18n'

const fetcher = async (url: string) => {
  const res = await fetch(url)
  const json = await res.json()
  if (json.error) throw new Error(json.error)
  return json.data
}

type Alert = {
  id: string
  symbol: string
  condition: 'above' | 'below' | 'pct_change_daily'
  target_value: number
  is_active: boolean
  created_at: string
}

export default function AlertsPage() {
  const { t } = useTranslation()
  const { data: alerts, isLoading, error, mutate } = useSWR<Alert[]>('/api/alerts', fetcher, {
    refreshInterval: 30_000,
  })

  const [toggling, setToggling] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  const handleToggleAlert = async (alertId: string, currentActive: boolean) => {
    setToggling(alertId)
    try {
      const response = await fetch(`/api/alerts/${alertId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          is_active: !currentActive,
        }),
      })

      const result = await response.json()

      if (!response.ok) {
        toast.error(result.error || t.alerts.error_update)
        return
      }

      toast.success(currentActive ? t.alerts.alert_disabled : t.alerts.alert_enabled)
      mutate()
    } catch {
      toast.error(t.alerts.error_update)
    } finally {
      setToggling(null)
    }
  }

  const handleDeleteAlert = async (alertId: string) => {
    setDeleting(alertId)
    try {
      const response = await fetch(`/api/alerts/${alertId}`, {
        method: 'DELETE',
      })

      const result = await response.json()

      if (!response.ok) {
        toast.error(result.error || t.alerts.error_delete)
        return
      }

      toast.success(t.alerts.alert_deleted)
      mutate()
    } catch {
      toast.error(t.alerts.error_delete)
    } finally {
      setDeleting(null)
    }
  }

  if (error) return <ErrorDisplay error={t.alerts.error_loading} onRetry={() => window.location.reload()} />

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">{t.alerts.title}</h1>
        <CreateAlertModal />
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-16 bg-secondary rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : !alerts || alerts.length === 0 ? (
        <Card className="rounded-2xl border-border shadow-sm">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="p-4 rounded-2xl bg-primary/10 mb-4">
              <Bell className="h-8 w-8 text-primary" />
            </div>
            <h3 className="font-semibold text-lg mb-2">{t.alerts.no_alerts}</h3>
            <p className="text-sm text-muted-foreground text-center max-w-sm">
              {t.alerts.no_alerts_desc}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {alerts.map(alert => (
            <Card key={alert.id} className="rounded-2xl border-border shadow-sm">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <span className="font-bold">{alert.symbol}</span>
                    <span className="text-muted-foreground">
                      {alert.condition === 'above' ? t.alerts.above : alert.condition === 'below' ? t.alerts.below : t.alerts.change} ${alert.target_value?.toFixed(2) ?? '--'}
                    </span>
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${alert.is_active ? 'bg-gain/10 text-gain' : 'bg-muted text-muted-foreground'}`}>
                      {alert.is_active ? t.alerts.active : t.alerts.inactive}
                    </span>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => handleToggleAlert(alert.id, alert.is_active)}
                      disabled={toggling === alert.id || deleting === alert.id}
                      title={alert.is_active ? t.alerts.disable : t.alerts.enable}
                    >
                      <Power className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => handleDeleteAlert(alert.id)}
                      disabled={toggling === alert.id || deleting === alert.id}
                      title={t.common.delete}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
