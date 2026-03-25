'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Bell, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import useSWR from 'swr'

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
  const { data: alerts, isLoading } = useSWR<Alert[]>('/api/alerts', fetcher, {
    refreshInterval: 30_000,
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Alertas</h1>
        <Button className="rounded-xl gap-2" disabled>
          <Plus className="h-4 w-4" />
          Nueva Alerta
        </Button>
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
            <h3 className="font-semibold text-lg mb-2">Sin alertas configuradas</h3>
            <p className="text-sm text-muted-foreground text-center max-w-sm">
              Las alertas de precio estaran disponibles proximamente. Podras recibir notificaciones cuando tus activos alcancen el precio objetivo.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {alerts.map(alert => (
            <Card key={alert.id} className="rounded-2xl border-border shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <span className="font-bold">{alert.symbol}</span>
                  <span className="text-muted-foreground">
                    {alert.condition === 'above' ? 'sube a' : alert.condition === 'below' ? 'baja a' : 'cambia'} ${alert.target_value.toFixed(2)}
                  </span>
                  <span className={`ml-auto text-xs px-2 py-0.5 rounded-full ${alert.is_active ? 'bg-gain/10 text-gain' : 'bg-muted text-muted-foreground'}`}>
                    {alert.is_active ? 'Activa' : 'Inactiva'}
                  </span>
                </CardTitle>
              </CardHeader>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
