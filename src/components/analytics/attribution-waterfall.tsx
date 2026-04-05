'use client'

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
  ReferenceLine,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { getChartTheme } from '@/lib/utils/chart-config'
import { formatNumber } from '@/lib/utils/numbers'
import { formatAxisTick } from '@/lib/utils/chart-config'
import { FinanceTooltip } from '@/components/shared/finance-tooltip'

type AttributionSector = {
  sector: string
  portfolio_weight: number
  benchmark_weight: number
  portfolio_return: number
  benchmark_return: number
  allocation_effect: number
  selection_effect: number
  interaction_effect: number
  total_effect: number
}

type Props = {
  sectors: AttributionSector[]
  total: {
    allocation_effect: number
    selection_effect: number
    interaction_effect: number
    total_excess: number
  }
  isLoading?: boolean
}

type WaterfallBar = {
  name: string
  value: number
  cumulative: number
  base: number
  fill: string
  isTotal?: boolean
  allocation_effect?: number
  selection_effect?: number
  interaction_effect?: number
}

function buildWaterfallData(
  sectors: AttributionSector[],
  total: Props['total'],
): WaterfallBar[] {
  const theme = getChartTheme()
  const bars: WaterfallBar[] = []
  let cumulative = 0

  for (const s of sectors) {
    const base = cumulative
    cumulative += s.total_effect
    bars.push({
      name: s.sector,
      value: s.total_effect,
      cumulative,
      base: s.total_effect >= 0 ? base : cumulative,
      fill: s.total_effect >= 0 ? theme.colors.positive : theme.colors.negative,
      allocation_effect: s.allocation_effect,
      selection_effect: s.selection_effect,
      interaction_effect: s.interaction_effect,
    })
  }

  bars.push({
    name: 'Total',
    value: total.total_excess,
    cumulative: total.total_excess,
    base: 0,
    fill: theme.colors.benchmarks[0],
    isTotal: true,
    allocation_effect: total.allocation_effect,
    selection_effect: total.selection_effect,
    interaction_effect: total.interaction_effect,
  })

  return bars
}

function CustomTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: Array<{ payload: WaterfallBar }>
  label?: string
}) {
  if (!active || !payload?.[0]) return null
  const d = payload[0].payload

  return (
    <div className="rounded-lg border bg-popover p-3 shadow-md text-popover-foreground">
      <p className="text-sm font-medium mb-2">{d.name}</p>
      <div className="space-y-1 text-xs font-mono">
        {d.allocation_effect != null && (
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">Asignacion</span>
            <span className={d.allocation_effect >= 0 ? 'text-green-600' : 'text-red-500'}>
              {formatNumber(d.allocation_effect)}%
            </span>
          </div>
        )}
        {d.selection_effect != null && (
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">Seleccion</span>
            <span className={d.selection_effect >= 0 ? 'text-green-600' : 'text-red-500'}>
              {formatNumber(d.selection_effect)}%
            </span>
          </div>
        )}
        {d.interaction_effect != null && (
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">Interaccion</span>
            <span className={d.interaction_effect >= 0 ? 'text-green-600' : 'text-red-500'}>
              {formatNumber(d.interaction_effect)}%
            </span>
          </div>
        )}
        <div className="flex justify-between gap-4 border-t pt-1 mt-1">
          <span className="text-muted-foreground font-medium">Total</span>
          <span className={d.value >= 0 ? 'text-green-600' : 'text-red-500'}>
            {formatNumber(d.value)}%
          </span>
        </div>
      </div>
    </div>
  )
}

function effectColor(value: number): string {
  if (value > 0) return 'text-green-600'
  if (value < 0) return 'text-red-500'
  return 'text-muted-foreground'
}

export function AttributionWaterfall({ sectors, total, isLoading }: Props) {
  const theme = getChartTheme()

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <Skeleton className="h-4 w-64" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-[300px] w-full rounded-xl" />
          <div className="space-y-3">
            <div className="flex gap-4">
              {Array.from({ length: 9 }).map((_, i) => (
                <Skeleton key={i} className="h-4 flex-1" />
              ))}
            </div>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex gap-4">
                {Array.from({ length: 9 }).map((_, j) => (
                  <Skeleton key={j} className="h-8 flex-1" />
                ))}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    )
  }

  if (!sectors || sectors.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">
            Atribucion de Rendimiento (BHB)
          </CardTitle>
        </CardHeader>
        <CardContent className="py-8 text-center text-muted-foreground">
          Se requieren datos suficientes para la atribucion
        </CardContent>
      </Card>
    )
  }

  const waterfallData = buildWaterfallData(sectors, total)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium inline-flex items-center gap-1">
          Atribucion de Rendimiento (BHB)
          <FinanceTooltip term="Portafolio" />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Waterfall Chart */}
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={waterfallData} barCategoryGap="20%">
            <XAxis
              dataKey="name"
              {...theme.xAxis}
              interval={0}
              angle={-35}
              textAnchor="end"
              height={60}
            />
            <YAxis
              {...theme.yAxis}
              tickFormatter={(v) => formatAxisTick(v, 'percent')}
            />
            <Tooltip
              content={<CustomTooltip />}
              cursor={{ fill: 'hsl(var(--muted) / 0.3)' }}
            />
            <ReferenceLine y={0} stroke="hsl(var(--border))" strokeDasharray="3 3" />
            {/* Invisible base bar to create stacking offset */}
            <Bar dataKey="base" stackId="waterfall" fill="transparent" isAnimationActive={false} />
            {/* Visible value bar stacked on top of base */}
            <Bar
              dataKey="value"
              stackId="waterfall"
              radius={[3, 3, 0, 0]}
              isAnimationActive={true}
            >
              {waterfallData.map((entry, index) => (
                <Cell key={index} fill={entry.fill} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>

        {/* Detail Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs font-mono">
            <thead>
              <tr className="border-b text-muted-foreground">
                <th className="text-left py-2 pr-3 font-medium">Sector</th>
                <th className="text-right py-2 px-2 font-medium">Peso Port.</th>
                <th className="text-right py-2 px-2 font-medium">Peso Bench.</th>
                <th className="text-right py-2 px-2 font-medium">Ret. Port.</th>
                <th className="text-right py-2 px-2 font-medium">Ret. Bench.</th>
                <th className="text-right py-2 px-2 font-medium">Asignacion</th>
                <th className="text-right py-2 px-2 font-medium">Seleccion</th>
                <th className="text-right py-2 px-2 font-medium">Interaccion</th>
                <th className="text-right py-2 pl-2 font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {sectors.map((s) => (
                <tr key={s.sector} className="border-b border-border/50 hover:bg-muted/30">
                  <td className="py-2 pr-3 font-medium text-foreground">{s.sector}</td>
                  <td className="text-right py-2 px-2">{formatNumber(s.portfolio_weight)}%</td>
                  <td className="text-right py-2 px-2">{formatNumber(s.benchmark_weight)}%</td>
                  <td className="text-right py-2 px-2">{formatNumber(s.portfolio_return)}%</td>
                  <td className="text-right py-2 px-2">{formatNumber(s.benchmark_return)}%</td>
                  <td className={`text-right py-2 px-2 ${effectColor(s.allocation_effect)}`}>
                    {formatNumber(s.allocation_effect)}%
                  </td>
                  <td className={`text-right py-2 px-2 ${effectColor(s.selection_effect)}`}>
                    {formatNumber(s.selection_effect)}%
                  </td>
                  <td className={`text-right py-2 px-2 ${effectColor(s.interaction_effect)}`}>
                    {formatNumber(s.interaction_effect)}%
                  </td>
                  <td className={`text-right py-2 pl-2 font-medium ${effectColor(s.total_effect)}`}>
                    {formatNumber(s.total_effect)}%
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 font-medium">
                <td className="py-2 pr-3">Total</td>
                <td className="text-right py-2 px-2">
                  {formatNumber(sectors.reduce((a, s) => a + s.portfolio_weight, 0))}%
                </td>
                <td className="text-right py-2 px-2">
                  {formatNumber(sectors.reduce((a, s) => a + s.benchmark_weight, 0))}%
                </td>
                <td className="text-right py-2 px-2">--</td>
                <td className="text-right py-2 px-2">--</td>
                <td className={`text-right py-2 px-2 ${effectColor(total.allocation_effect)}`}>
                  {formatNumber(total.allocation_effect)}%
                </td>
                <td className={`text-right py-2 px-2 ${effectColor(total.selection_effect)}`}>
                  {formatNumber(total.selection_effect)}%
                </td>
                <td className={`text-right py-2 px-2 ${effectColor(total.interaction_effect)}`}>
                  {formatNumber(total.interaction_effect)}%
                </td>
                <td className={`text-right py-2 pl-2 ${effectColor(total.total_excess)}`}>
                  {formatNumber(total.total_excess)}%
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Legend */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs text-muted-foreground">
          <div className="flex items-start gap-2">
            <div className="mt-1 h-2 w-2 rounded-full bg-amber-600 shrink-0" />
            <p>
              <span className="font-medium text-foreground">Asignacion:</span>{' '}
              Efecto de tus decisiones de peso por sector
            </p>
          </div>
          <div className="flex items-start gap-2">
            <div className="mt-1 h-2 w-2 rounded-full bg-blue-600 shrink-0" />
            <p>
              <span className="font-medium text-foreground">Seleccion:</span>{' '}
              Efecto de elegir acciones dentro del sector
            </p>
          </div>
          <div className="flex items-start gap-2">
            <div className="mt-1 h-2 w-2 rounded-full bg-zinc-500 shrink-0" />
            <p>
              <span className="font-medium text-foreground">Interaccion:</span>{' '}
              Efecto combinado
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
