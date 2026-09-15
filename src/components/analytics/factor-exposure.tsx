'use client'

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  ErrorBar,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { SkeletonChart } from '@/components/shared/skeleton-chart'
import { getChartTheme, SERIES_PALETTE } from '@/lib/utils/chart-config'
import { Layers } from 'lucide-react'
import type { FactorsData } from '@/lib/hooks/use-analytics'
import { ChartFigure } from '@/components/charts/chart-figure'

/**
 * Which known risks this portfolio is actually taking.
 *
 * The chart is a bar per factor, but the bar is not the point — the ERROR BAR
 * is. A loading of 0.4 with a standard error of 0.5 and a loading of 0.4 with a
 * standard error of 0.05 look identical as bars and mean completely different
 * things, and showing only the bar is how a regression coefficient gets read as
 * a fact. Insignificant factors are drawn hollow and labelled, so the reader
 * cannot mistake noise for a tilt.
 */

/** |t| at or above this is conventionally called significant. */
const T_SIGNIFICANCE = 2

type Props = {
  data?: FactorsData
  isLoading?: boolean
}

type Row = {
  factor: string
  coefficient: number
  error: number
  significant: boolean
  tStat: number | null
}

function FactorTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: Array<{ payload: Row }>
}) {
  if (!active || !payload?.length) return null
  const row = payload[0].payload

  return (
    <div className="rounded-lg border bg-card px-3 py-2 shadow-md space-y-1 max-w-64">
      <p className="text-xs font-medium text-foreground">{row.factor}</p>
      <p className="text-sm font-financial font-semibold text-foreground">
        {row.coefficient >= 0 ? '+' : ''}
        {row.coefficient.toFixed(2)}
        <span className="text-[11px] font-normal text-muted-foreground">
          {' '}
          ± {row.error.toFixed(2)}
        </span>
      </p>
      <p className="text-[11px] text-muted-foreground">
        {row.significant
          ? `Se distingue del ruido (t = ${row.tStat?.toFixed(1) ?? 'n/d'}).`
          : `NO se distingue del ruido (t = ${row.tStat?.toFixed(1) ?? 'n/d'}): con estos datos no se puede afirmar que tengas esta inclinacion.`}
      </p>
    </div>
  )
}

export function FactorExposure({ data, isLoading }: Props) {
  const theme = getChartTheme()

  const header = (
    <CardHeader>
      <CardTitle className="text-sm font-medium flex items-center gap-2">
        <Layers className="h-4 w-4" />
        Exposicion factorial
      </CardTitle>
      {data?.regression && data.from_date && (
        <CardDescription className="text-xs font-financial">
          {data.regression.observations} dias ({data.from_date} a {data.to_date}) · R²{' '}
          {(data.regression.rSquared * 100).toFixed(0)}%
        </CardDescription>
      )}
    </CardHeader>
  )

  if (isLoading) {
    return (
      <Card>
        {header}
        <CardContent>
          <SkeletonChart />
        </CardContent>
      </Card>
    )
  }

  if (!data?.regression) {
    return (
      <Card>
        {header}
        <CardContent className="flex flex-col items-center justify-center py-10">
          <div className="p-3 rounded-2xl bg-muted/50 mb-3">
            <Layers className="h-6 w-6 text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground text-center max-w-md">
            {data?.message ?? 'Todavia no hay datos suficientes para descomponer tu cartera en factores.'}
          </p>
        </CardContent>
      </Card>
    )
  }

  const regression = data.regression
  const rows: Row[] = regression.loadings.map((loading) => ({
    factor: loading.factor,
    coefficient: loading.coefficient,
    error: loading.standardError,
    significant: loading.significant,
    tStat: loading.tStat,
  }))

  const describeLoading = (row: Row) =>
    `${row.factor} ${row.coefficient >= 0 ? '+' : ''}${row.coefficient.toFixed(2)} ± ${row.error.toFixed(2)}${row.significant ? '' : ' (no se distingue del ruido)'}`
  const summary = `Exposición a ${rows.length} factores de riesgo, cada una con su margen de error: ${rows
    .map(describeLoading)
    .join('; ')}.`
  const table = {
    caption: 'Exposición por factor',
    columns: ['Factor', 'Coeficiente', 'Margen de error', 't', 'Lectura'],
    rows: rows.map((row) => [
      row.factor,
      `${row.coefficient >= 0 ? '+' : ''}${row.coefficient.toFixed(2)}`,
      `± ${row.error.toFixed(2)}`,
      row.tStat === null ? 'n/d' : row.tStat.toFixed(1),
      row.significant ? 'Inclinación real' : 'No se distingue del ruido',
    ]),
  }

  const alphaSignificant =
    regression.alphaTStat === null
      ? Math.abs(regression.alphaAnnualPct) > 0
      : Math.abs(regression.alphaTStat) >= T_SIGNIFICANCE

  return (
    <Card>
      {header}
      <CardContent className="space-y-4">
        <ChartFigure summary={summary} table={table}>
          <ResponsiveContainer width="100%" height={Math.max(200, rows.length * 44)}>
            <BarChart accessibilityLayer={false} data={rows} layout="vertical" margin={{ left: 8, right: 24 }}>
              <XAxis type="number" {...theme.xAxis} domain={['auto', 'auto']} />
              <YAxis
                type="category"
                dataKey="factor"
                {...theme.yAxis}
                width={140}
                tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
              />
              <Tooltip content={<FactorTooltip />} cursor={{ fill: 'var(--muted)', fillOpacity: 0.3 }} />
              {/* Zero is the meaningful baseline here: it is "no tilt at all". */}
              <ReferenceLine x={0} stroke={theme.grid.stroke} />
              <Bar dataKey="coefficient" radius={[0, 4, 4, 0]} isAnimationActive={false}>
                {rows.map((row) => (
                  <Cell
                    key={row.factor}
                    fill={row.significant ? SERIES_PALETTE[0] : 'var(--muted)'}
                    stroke={row.significant ? 'none' : SERIES_PALETTE[0]}
                    strokeDasharray={row.significant ? undefined : '3 3'}
                  />
                ))}
                {/* The part that matters: how much the coefficient could be off by. */}
                <ErrorBar
                  dataKey="error"
                  width={4}
                  strokeWidth={1.5}
                  stroke="var(--muted-foreground)"
                  direction="x"
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartFigure>

        <div className="flex flex-wrap gap-4 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ background: SERIES_PALETTE[0] }}
            />
            Inclinacion real
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm border border-dashed"
              style={{ borderColor: SERIES_PALETTE[0], background: 'var(--muted)' }}
            />
            No se distingue del ruido
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-px w-4 bg-muted-foreground" />
            Margen de error (± 1 desv.)
          </span>
        </div>

        <div className="rounded-xl bg-muted/40 p-3 space-y-2">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-xs text-muted-foreground">Alfa tras descontar factores</span>
            <span
              className={`text-sm font-financial font-semibold ${
                alphaSignificant
                  ? regression.alphaAnnualPct >= 0
                    ? 'text-gain'
                    : 'text-loss'
                  : 'text-muted-foreground'
              }`}
            >
              {regression.alphaAnnualPct >= 0 ? '+' : ''}
              {regression.alphaAnnualPct.toFixed(2)}%
              {!alphaSignificant && <span className="text-[11px] font-normal"> (no concluyente)</span>}
            </span>
          </div>
          {data.summary && (
            <p className="text-[11px] text-muted-foreground leading-relaxed">{data.summary}</p>
          )}
        </div>

        {/* A loading means nothing to a reader who does not know what the series is. */}
        {data.definitions && data.definitions.length > 0 && (
          <details className="text-[11px] text-muted-foreground">
            <summary className="cursor-pointer text-foreground/80 hover:text-foreground">
              Que es cada factor y como se construye
            </summary>
            <dl className="mt-2 space-y-2">
              {data.definitions.map((definition) => (
                <div key={definition.id}>
                  <dt className="text-foreground/90">
                    {definition.name}{' '}
                    <span className="font-mono text-[10px]">
                      ({definition.symbols.join(' - ')})
                    </span>
                  </dt>
                  <dd className="leading-relaxed">{definition.construction}</dd>
                  <dd className="leading-relaxed italic">{definition.meaning}</dd>
                </div>
              ))}
            </dl>
          </details>
        )}
      </CardContent>
    </Card>
  )
}
