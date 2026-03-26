'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatNumber } from '@/lib/utils/numbers'
import { FinanceTooltip } from '@/components/shared/finance-tooltip'
import useSWR from 'swr'

const fetcher = (url: string) => fetch(url).then(r => r.json()).then(r => r.data)

export function RiskMetrics({ portfolioId }: { portfolioId: string }) {
  const { data, isLoading } = useSWR(`/api/analytics/${portfolioId}/risk`, fetcher)

  if (isLoading) return <Card><CardContent className="py-8 text-center text-muted-foreground">Calculando...</CardContent></Card>

  if (data?.message) {
    return <Card><CardContent className="py-8 text-center text-muted-foreground">{data.message}</CardContent></Card>
  }

  const metrics = [
    { label: 'Volatilidad (anual)', value: `${formatNumber(data?.volatility || 0)}%`, description: 'Desviacion estandar anualizada', tooltipTerm: 'Volatilidad' },
    { label: 'Sharpe Ratio', value: formatNumber(data?.sharpe || 0), description: 'Rendimiento ajustado por riesgo (rf = CETES 28d)', tooltipTerm: 'Sharpe Ratio' },
    { label: 'Max Drawdown', value: `${formatNumber(data?.maxDrawdown || 0)}%`, description: 'Mayor caida desde el pico', tooltipTerm: 'Max Drawdown' },
  ]

  return (
    <Card>
      <CardHeader><CardTitle className="text-sm font-medium">Metricas de Riesgo</CardTitle></CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {metrics.map(m => (
            <div key={m.label} className="text-center p-3 rounded-lg bg-muted/50">
              <p className="text-2xl font-bold font-mono">{m.value}</p>
              <p className="text-sm font-medium mt-1 inline-flex items-center gap-1">
                {m.label}
                <FinanceTooltip term={m.tooltipTerm} />
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">{m.description}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
