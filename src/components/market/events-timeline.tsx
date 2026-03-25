'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Calendar, TrendingUp, DollarSign, Megaphone } from 'lucide-react'

type MarketEvent = {
  id: string
  event_type: 'earnings' | 'dividend' | 'split' | 'conference'
  event_date: string
  title: string
  description: string
}

const EVENT_ICONS = {
  earnings: TrendingUp,
  dividend: DollarSign,
  split: Calendar,
  conference: Megaphone,
}

const EVENT_LABELS = {
  earnings: 'Reporte',
  dividend: 'Dividendo',
  split: 'Split',
  conference: 'Conferencia',
}

export function EventsTimeline({ events }: { events: MarketEvent[] }) {
  if (events.length === 0) {
    return (
      <Card className="rounded-2xl border-border shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Proximos Eventos</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-4">Sin eventos proximos</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="rounded-2xl border-border shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Proximos Eventos</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {events.map((event) => {
            const Icon = EVENT_ICONS[event.event_type] || Calendar
            const label = EVENT_LABELS[event.event_type] || event.event_type
            const date = new Date(event.event_date + 'T00:00:00')
            const formatted = date.toLocaleDateString('es-MX', { month: 'short', day: 'numeric', year: 'numeric' })
            const daysUntil = Math.ceil((date.getTime() - Date.now()) / (1000 * 60 * 60 * 24))

            return (
              <div key={event.id} className="flex items-start gap-3">
                <div className="p-2 rounded-xl bg-primary/10 shrink-0">
                  <Icon className="h-4 w-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-primary">{label}</span>
                    <span className="text-xs text-muted-foreground">{formatted}</span>
                    {daysUntil > 0 && daysUntil <= 7 && (
                      <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">
                        en {daysUntil}d
                      </span>
                    )}
                  </div>
                  <p className="text-sm font-medium truncate">{event.title}</p>
                </div>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
