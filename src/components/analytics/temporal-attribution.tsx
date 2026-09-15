'use client'

import { useMemo, useState } from 'react'
import { ResponsiveContainer, ComposedChart, Bar, Scatter, XAxis, YAxis, Tooltip, ReferenceLine, CartesianGrid } from 'recharts'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartFigure } from '@/components/charts/chart-figure'
import { ChartTooltipContent } from '@/components/charts/chart-tooltip'
import { ChartEmpty, ChartLoading } from '@/components/charts/chart-state'
import { getChartTheme, assignSeriesColors, foldToSeriesCap, SERIES_PALETTE } from '@/lib/utils/chart-config'
import { useTemporalAttribution } from '@/lib/hooks/use-analytics'
import { changeTone, toneTextClass } from '@/lib/utils/change-tone'
import { AuditTrail } from '@/components/analytics/audit-trail'
import type { AttributionBucket, Granularity } from '@/lib/services/temporal-attribution'

/**
 * How each holding's contribution to the return changed over time (P2-4).
 *
 * Bars stack each holding's contribution in percentage points — gains above
 * zero, losses below — and a marker shows the book's return for the bucket,
 * which the bars add up to. Holdings past the palette fold into "Otros".
 */

const GRANULARITY_OPTIONS: Array<{ id: Granularity; label: string }> = [
  { id: 'day', label: 'Día' },
  { id: 'week', label: 'Semana' },
  { id: 'month', label: 'Mes' },
  { id: 'quarter', label: 'Trimestre' },
  { id: 'year', label: 'Año' },
]
const PERIOD_OPTIONS = ['1M', '3M', '6M', 'YTD', '1Y', 'ALL'] as const
const OTHER = 'Otros'
const CHART_HEIGHT = 300

const pp = (value: number) => `${value > 0 ? '+' : ''}${value.toFixed(2)} pp`
const pct = (value: number | null) => (value === null ? '—' : `${value > 0 ? '+' : ''}${value.toFixed(2)}%`)

function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: ReadonlyArray<{ id: T; label: string }>
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={value === option.id}
          onClick={() => onChange(option.id)}
          className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
            value === option.id ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function TemporalAttribution({ portfolioId }: { portfolioId: string }) {
  const [granularity, setGranularity] = useState<Granularity>('month')
  const [period, setPeriod] = useState<(typeof PERIOD_OPTIONS)[number]>('1Y')
  const { data, error, isLoading, mutate } = useTemporalAttribution(portfolioId, granularity, period)
  const theme = getChartTheme()

  const view = useMemo(() => {
    const buckets: AttributionBucket[] = data?.buckets ?? []
    const totals = new Map<string, number>()
    for (const bucket of buckets) {
      for (const h of bucket.holdings) totals.set(h.symbol, (totals.get(h.symbol) ?? 0) + Math.abs(h.contributionPct))
    }
    // The palette carries eight series: the largest absolute contributors keep
    // a colour, the rest fold into "Otros" so no two holdings share one.
    const folded = foldToSeriesCap([...totals.entries()], ([, v]) => v, SERIES_PALETTE.length)
    const kept = folded.kept.map(([symbol]) => symbol)
    const series = folded.otherCount > 0 ? [...kept, OTHER] : kept
    const colors = assignSeriesColors(series)
    const keptSet = new Set(kept)

    const rows = buckets.map((bucket) => {
      const row: Record<string, number | string> = { key: bucket.key, label: bucket.label, portfolio: bucket.portfolioReturnPct }
      for (const h of bucket.holdings) {
        const name = keptSet.has(h.symbol) ? h.symbol : OTHER
        row[name] = ((row[name] as number | undefined) ?? 0) + h.contributionPct
      }
      return row
    })
    return { buckets, series, colors, rows }
  }, [data])

  const total = data?.total ?? null
  const best = total?.holdings[0]
  const worst = total?.holdings[total.holdings.length - 1]
  const summary =
    total && best && worst
      ? `Contribución de cada activo por ${GRANULARITY_OPTIONS.find((g) => g.id === granularity)!.label.toLowerCase()} en ${view.buckets.length} periodos, de ${total.start} a ${total.end}. Rendimiento del periodo completo: ${pct(total.portfolioReturnPct)}. Mayor aporte: ${best.symbol} con ${pp(best.contributionPct)}; menor: ${worst.symbol} con ${pp(worst.contributionPct)}.`
      : 'Contribución de cada activo a lo largo del tiempo.'
  const table = {
    caption: 'Contribución por periodo, en puntos porcentuales',
    columns: ['Periodo', 'Portafolio', ...view.series],
    rows: view.rows.map((row) => [
      String(row.label),
      pct(Number(row.portfolio)),
      ...view.series.map((s) => (typeof row[s] === 'number' ? pp(row[s] as number) : '—')),
    ]),
  }

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="space-y-1.5">
          <CardTitle className="text-sm font-medium">Contribución en el tiempo</CardTitle>
          <CardDescription className="text-xs">
            Cuánto aportó cada activo al rendimiento en cada periodo, en puntos porcentuales. Las barras de un periodo
            suman su rendimiento.
          </CardDescription>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SegmentedControl label="Agrupar por" options={GRANULARITY_OPTIONS} value={granularity} onChange={setGranularity} />
          <SegmentedControl
            label="Periodo"
            options={PERIOD_OPTIONS.map((p) => ({ id: p, label: p === 'ALL' ? 'Todo' : p }))}
            value={period}
            onChange={setPeriod}
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading && !data ? (
          <ChartLoading height={CHART_HEIGHT} label="Calculando la contribución en el tiempo…" />
        ) : error && !data ? (
          <ChartEmpty height={CHART_HEIGHT} kind="error" message="No se pudo calcular la contribución." onRetry={() => mutate()} />
        ) : view.buckets.length === 0 ? (
          <ChartEmpty height={CHART_HEIGHT} message="No hay historial suficiente en este periodo para medir contribuciones." />
        ) : (
          <ChartFigure summary={summary} table={table}>
            <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
              <ComposedChart accessibilityLayer={false} data={view.rows} stackOffset="sign" margin={{ top: 8, right: 8 }}>
                <CartesianGrid {...theme.grid} />
                <XAxis dataKey="label" {...theme.xAxis} minTickGap={24} />
                <YAxis {...theme.yAxis} width={56} tickFormatter={(v: number) => `${v.toFixed(1)}`} />
                <ReferenceLine y={0} stroke={theme.grid.stroke} />
                <Tooltip
                  cursor={{ fill: 'var(--muted)', fillOpacity: 0.3 }}
                  content={
                    <ChartTooltipContent
                      includeEntry={(entry) => entry.dataKey !== 'label'}
                      nameFormatter={(name) => (name === 'portfolio' ? 'Portafolio' : name)}
                      valueFormatter={(value, entry) =>
                        typeof value === 'number' ? (entry.dataKey === 'portfolio' ? pct(value) : pp(value)) : '—'
                      }
                    />
                  }
                />
                {view.series.map((symbol) => (
                  <Bar key={symbol} dataKey={symbol} stackId="contribution" fill={view.colors[symbol]} isAnimationActive={false} />
                ))}
                <Scatter dataKey="portfolio" fill="var(--foreground)" shape="diamond" isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </ChartFigure>
        )}

        {total && total.holdings.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <caption className="mb-2 text-left text-xs text-muted-foreground">
                Periodo completo ({total.start} a {total.end}):{' '}
                <span className={`font-financial font-medium ${toneTextClass(changeTone(total.portfolioReturnPct))}`}>
                  {pct(total.portfolioReturnPct)}
                </span>
              </caption>
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th scope="col" className="py-2 pr-3 text-left font-medium">Activo</th>
                  <th scope="col" className="px-2 py-2 text-right font-medium">Contribución</th>
                  <th scope="col" className="px-2 py-2 text-right font-medium">Rendimiento propio</th>
                  <th scope="col" className="py-2 pl-2 text-right font-medium">Peso medio</th>
                </tr>
              </thead>
              <tbody>
                {total.holdings.map((h) => (
                  <tr key={h.symbol} className="border-b border-border/50">
                    <th scope="row" className="py-1.5 pr-3 text-left font-mono font-medium">
                      {h.symbol}
                    </th>
                    <td className={`px-2 py-1.5 text-right font-financial ${toneTextClass(changeTone(h.contributionPct))}`}>
                      {pp(h.contributionPct)}
                    </td>
                    <td className="px-2 py-1.5 text-right font-financial">{pct(h.assetReturnPct)}</td>
                    <td className="py-1.5 pl-2 text-right font-financial">{h.averageWeightPct.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Rendimiento de precio, con la misma convención que el rendimiento ponderado por tiempo: comprar más no cuenta
          como ganancia. Las contribuciones de varios días se enlazan con el método de Carino (1999) para que sumen
          exactamente el rendimiento compuesto del periodo. No incluye dividendos.
          {data && data.unmeasurable > 0 ? ` ${data.unmeasurable} tramos sin capital inicial no se pudieron medir.` : ''}
        </p>
        <AuditTrail meta={data?._meta} />
      </CardContent>
    </Card>
  )
}
