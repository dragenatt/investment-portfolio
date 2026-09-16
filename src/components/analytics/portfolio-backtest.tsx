'use client'

import { useState } from 'react'
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip } from 'recharts'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartFigure } from '@/components/charts/chart-figure'
import { ChartLoading } from '@/components/charts/chart-state'
import { AuditTrail } from '@/components/analytics/audit-trail'
import { usePortfolioBacktest } from '@/lib/hooks/use-analytics'
import { getChartTheme, SERIES_PALETTE } from '@/lib/utils/chart-config'
import { formatChartMoney, seriesTable } from '@/lib/utils/chart-accessibility'
import type { RebalanceFrequency } from '@/lib/services/backtest'

// P1-17. backtestPortfolio ran the current book through history under five
// rebalancing schedules, behind a route and a background job — and no screen
// ever asked for it. Five rows, no winner declared: which schedule comes out
// ahead depends on the period, and the card says so.

const SCHEDULE_LABELS: Record<RebalanceFrequency, string> = {
  none: 'Sin rebalanceo (comprar y mantener)',
  monthly: 'Mensual',
  quarterly: 'Trimestral',
  semiannual: 'Semestral',
  annual: 'Anual',
}

const COST_OPTIONS = [0, 0.1, 0.25, 0.5]

const pct = (value: number | null | undefined, digits = 2) =>
  value === null || value === undefined || !Number.isFinite(value) ? '—' : `${value.toFixed(digits)}%`
const ratio = (value: number | null | undefined) =>
  value === null || value === undefined || !Number.isFinite(value) ? '—' : value.toFixed(2)

function CurveTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ dataKey: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="chart-tooltip">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      {payload.map((entry) => (
        <div key={entry.dataKey} className="flex items-center gap-2 text-sm">
          <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
          <span>{SCHEDULE_LABELS[entry.dataKey as RebalanceFrequency] ?? entry.dataKey}</span>
          <span className="font-financial ml-auto">{formatChartMoney(entry.value, '')}</span>
        </div>
      ))}
    </div>
  )
}

export function PortfolioBacktest({ portfolioId }: { portfolioId: string }) {
  const [costPct, setCostPct] = useState(0.1)
  const { data, isLoading, error } = usePortfolioBacktest(portfolioId, costPct)
  const theme = getChartTheme()

  return (
    <Card className="rounded-2xl">
      <CardHeader>
        <CardTitle className="text-sm font-medium">Backtesting del portafolio</CardTitle>
        <CardDescription>
          Tus pesos actuales llevados hacia atrás en el tiempo bajo cinco calendarios de rebalanceo. Cada decisión usa
          solo precios hasta ese día; ningún calendario se declara el mejor.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="backtest-cost" className="text-xs text-muted-foreground">Costo por operación</label>
          <select
            id="backtest-cost"
            className="h-8 rounded-md border border-input bg-transparent px-2 text-sm"
            value={costPct}
            onChange={(e) => setCostPct(Number(e.target.value))}
          >
            {COST_OPTIONS.map((c) => <option key={c} value={c}>{c}% del monto</option>)}
          </select>
          <span className="text-xs text-muted-foreground">
            No es la comisión de tu broker: es un supuesto para ver cuánto le cuesta a cada calendario operar más.
          </span>
        </div>

        {isLoading ? (
          <ChartLoading height={260} label="Corriendo el backtest…" />
        ) : error ? (
          <p className="text-sm text-muted-foreground">No se pudo correr el backtest.</p>
        ) : !data || 'message' in data ? (
          <p className="text-sm text-muted-foreground">{data && 'message' in data ? data.message : 'Sin datos.'}</p>
        ) : (
          <>
            {(() => {
              const curves = data.schedules
              const rows = curves[0].equityCurve.map((point, i) => {
                const row: Record<string, string | number> = { date: point.date }
                for (const schedule of curves) row[schedule.rebalance] = schedule.equityCurve[i]?.value ?? Number.NaN
                return row
              })
              const summary = `Valor de 10,000 invertidos del ${data.from} al ${data.to}: ${curves
                .map((c) => `${SCHEDULE_LABELS[c.rebalance]} ${formatChartMoney(c.finalValue, '')}`)
                .join('; ')}.`
              const table = seriesTable(rows, 'Valor por fecha y calendario', ['Fecha', ...curves.map((c) => SCHEDULE_LABELS[c.rebalance])], (row) => [
                String(row.date),
                ...curves.map((c) => formatChartMoney(Number(row[c.rebalance]), '')),
              ])
              return (
                <ChartFigure summary={summary} table={table}>
                  <ResponsiveContainer width="100%" height={260}>
                    <LineChart accessibilityLayer={false} data={rows}>
                      <XAxis dataKey="date" {...theme.xAxis} interval="preserveStartEnd" minTickGap={40} />
                      <YAxis {...theme.yAxis} domain={['auto', 'auto']} />
                      <Tooltip content={<CurveTooltip />} />
                      {curves.map((c, i) => (
                        <Line key={c.rebalance} type="monotone" dataKey={c.rebalance} stroke={SERIES_PALETTE[i % SERIES_PALETTE.length]} strokeWidth={2} dot={false} />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </ChartFigure>
              )
            })()}

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">Resultado de cada calendario de rebalanceo</caption>
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th scope="col" className="py-2 pr-3 font-medium">Calendario</th>
                    <th scope="col" className="py-2 pr-3 font-medium text-right">CAGR</th>
                    <th scope="col" className="py-2 pr-3 font-medium text-right">Volatilidad</th>
                    <th scope="col" className="py-2 pr-3 font-medium text-right">Sharpe</th>
                    <th scope="col" className="py-2 pr-3 font-medium text-right">Sortino</th>
                    <th scope="col" className="py-2 pr-3 font-medium text-right">Caída máx.</th>
                    <th scope="col" className="py-2 pr-3 font-medium text-right">VaR 95%</th>
                    <th scope="col" className="py-2 pr-3 font-medium text-right">Rebalanceos</th>
                    <th scope="col" className="py-2 font-medium text-right">Costos</th>
                  </tr>
                </thead>
                <tbody>
                  {data.schedules.map((s) => (
                    <tr key={s.rebalance} className="border-t border-border">
                      <th scope="row" className="py-2 pr-3 text-left font-normal">{SCHEDULE_LABELS[s.rebalance]}</th>
                      <td className="py-2 pr-3 text-right font-financial">{pct(s.cagrPct)}</td>
                      <td className="py-2 pr-3 text-right font-financial">{pct(s.volatilityPct)}</td>
                      <td className="py-2 pr-3 text-right font-financial">{ratio(s.sharpe)}</td>
                      <td className="py-2 pr-3 text-right font-financial">{ratio(s.sortino)}</td>
                      <td className="py-2 pr-3 text-right font-financial">{pct(s.maxDrawdownPct)}</td>
                      <td className="py-2 pr-3 text-right font-financial">{pct(s.var95Pct)}</td>
                      <td className="py-2 pr-3 text-right font-financial">{s.rebalanceCount}</td>
                      <td className="py-2 text-right font-financial">{formatChartMoney(s.totalCosts, '')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="text-xs text-muted-foreground">
              Del <span className="font-financial">{data.from}</span> al <span className="font-financial">{data.to}</span>,{' '}
              <span className="font-financial">{data.observations}</span> días, sobre 10,000 de capital de escala. {data.note}{' '}
              Periodos cortos hacen que el CAGR se dispare o se hunda por unos pocos días.
              {data.excluded.length > 0 ? ` Sin historial suficiente, fuera de la prueba: ${data.excluded.join(', ')}.` : ''}
            </p>
            <AuditTrail meta={data._meta} />
          </>
        )}
      </CardContent>
    </Card>
  )
}
