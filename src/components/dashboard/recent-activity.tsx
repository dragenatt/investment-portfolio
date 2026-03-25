'use client'

import useSWR from 'swr'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ArrowUpRight, ArrowDownRight, Coins, Scissors } from 'lucide-react'

const fetcher = async (url: string) => {
  const res = await fetch(url)
  const json = await res.json()
  if (json.error) throw new Error(json.error)
  return json.data
}

type Transaction = {
  id: string
  type: 'buy' | 'sell' | 'dividend' | 'split'
  quantity: number
  price: number
  executed_at: string
  position: { portfolio_id: string; symbol: string }
}

const TYPE_ICON = {
  buy: ArrowUpRight,
  sell: ArrowDownRight,
  dividend: Coins,
  split: Scissors,
}

const TYPE_LABEL = {
  buy: 'Compraste',
  sell: 'Vendiste',
  dividend: 'Dividendo',
  split: 'Split',
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `hace ${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `hace ${hours}h`
  const days = Math.floor(hours / 24)
  return `hace ${days}d`
}

export function RecentActivity() {
  const { data: transactions, isLoading } = useSWR<Transaction[]>(
    '/api/transaction?limit=5',
    fetcher,
    { refreshInterval: 60_000 }
  )

  return (
    <Card className="rounded-2xl border-border shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Actividad Reciente</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-10 bg-secondary rounded-xl animate-pulse" />
            ))}
          </div>
        ) : !transactions || transactions.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">Sin transacciones recientes</p>
        ) : (
          <div className="space-y-2">
            {transactions.map(t => {
              const Icon = TYPE_ICON[t.type]
              const isPositive = t.type === 'buy' || t.type === 'dividend'
              return (
                <div key={t.id} className="flex items-center justify-between py-2">
                  <div className="flex items-center gap-3">
                    <div className={`p-1.5 rounded-lg ${isPositive ? 'bg-gain/10' : 'bg-loss/10'}`}>
                      <Icon className={`h-3.5 w-3.5 ${isPositive ? 'text-gain' : 'text-loss'}`} />
                    </div>
                    <div>
                      <p className="text-sm font-medium">
                        {TYPE_LABEL[t.type]} {t.quantity} {t.position.symbol}
                      </p>
                      <p className="text-xs text-muted-foreground">{timeAgo(t.executed_at)}</p>
                    </div>
                  </div>
                  <span className="text-sm font-mono">${(t.quantity * t.price).toFixed(2)}</span>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
