'use client'

// The advisor's two charts, moved out of the page unchanged so they can load on
// demand (C3): recharts no longer sits in the advisor's first-load bundle.

import {
  PieChart,
  Pie,
  Cell,
  Legend,
  Tooltip,
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
} from 'recharts'
import { ChartFigure } from '@/components/charts/chart-figure'
import { ChartTooltipContent } from '@/components/charts/chart-tooltip'
import { getChartTheme } from '@/lib/utils/chart-config'

export type DonutDatum = { name: string; value: number }

export type ProjectionDatum = {
  name: string
  rango90: [number, number]
  rango50: [number, number]
  mediana: number
  aportado: number
}

export function AdvisorAllocationDonut({
  donutData,
  colors,
}: {
  donutData: DonutDatum[]
  colors: readonly string[]
}) {
  const DONUT_COLORS = colors
  const summary = `Portafolio sugerido en ${donutData.length} clases de activo: ${donutData
    .map((d) => `${d.name} ${d.value}%`)
    .join(', ')}.`
  const table = {
    caption: 'Asignación sugerida',
    columns: ['Clase de activo', 'Peso'],
    rows: donutData.map((d) => [d.name, `${d.value}%`]),
  }
  return (
    <ChartFigure summary={summary} table={table}>
      <ResponsiveContainer width="100%" height={250}>
        <PieChart accessibilityLayer={false}>
          <Pie
            rootTabIndex={-1}
            data={donutData}
            cx="50%"
            cy="50%"
            innerRadius={60}
            outerRadius={90}
            paddingAngle={3}
            dataKey="value"
          >
            {donutData.map((_, idx) => (
              <Cell key={idx} fill={DONUT_COLORS[idx % DONUT_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip content={<ChartTooltipContent valueFormatter={(value) => `${Number(value).toFixed(0)}%`} />} />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    </ChartFigure>
  )
}

export function AdvisorProjectionChart({
  chartData,
  fmt,
}: {
  chartData: ProjectionDatum[]
  fmt: Intl.NumberFormat
}) {
  const theme = getChartTheme()
  const last = chartData[chartData.length - 1]
  const summary = last
    ? `Proyección de crecimiento hasta ${last.name}: mediana ${fmt.format(last.mediana)}; 8 de cada 10 escenarios terminan entre ${fmt.format(
        last.rango90[0],
      )} y ${fmt.format(last.rango90[1])}; lo aportado suma ${fmt.format(last.aportado)}.`
    : 'Proyección de crecimiento.'
  const table = {
    caption: 'Proyección por periodo',
    columns: ['Periodo', 'P10', 'P25', 'Mediana', 'P75', 'P90', 'Aportado'],
    rows: chartData.map((d) => [
      d.name,
      fmt.format(d.rango90[0]),
      fmt.format(d.rango50[0]),
      fmt.format(d.mediana),
      fmt.format(d.rango50[1]),
      fmt.format(d.rango90[1]),
      fmt.format(d.aportado),
    ]),
  }
  return (
    <ChartFigure summary={summary} table={table}>
      <ResponsiveContainer width="100%" height={320}>
        <ComposedChart accessibilityLayer={false} data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
          <CartesianGrid {...theme.grid} />
          <XAxis dataKey="name" {...theme.xAxis} />
          <YAxis {...theme.yAxis} tickFormatter={(v: number) => fmt.format(v)} width={90} />
          <Tooltip
            content={
              <ChartTooltipContent
                valueFormatter={(value) =>
                  Array.isArray(value)
                    ? `${fmt.format(Number(value[0]))} – ${fmt.format(Number(value[1]))}`
                    : fmt.format(Number(value))
                }
              />
            }
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />

          {/* One hue at two opacities rather than a red-to-green ramp. The
              spread is a likelihood axis, not a good-to-bad one, and
              colouring it that way tells the reader the opposite. */}
          <Area
            type="monotone"
            dataKey="rango90"
            stroke="none"
            fill="var(--chart-1)"
            fillOpacity={0.16}
            name="8 de cada 10 escenarios (P10–P90)"
            isAnimationActive={false}
          />
          <Area
            type="monotone"
            dataKey="rango50"
            stroke="none"
            fill="var(--chart-1)"
            fillOpacity={0.3}
            name="La mitad central (P25–P75)"
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="mediana"
            stroke="var(--chart-1)"
            strokeWidth={2}
            dot={false}
            name="Mediana (P50)"
            isAnimationActive={false}
          />
          {/* What was actually paid in. Where the fan's lower edge sits
              against this line is the question the chart is really for. */}
          <Line
            type="monotone"
            dataKey="aportado"
            stroke="var(--muted-foreground)"
            strokeWidth={1.5}
            strokeDasharray="4 4"
            dot={false}
            name="Lo que aportas"
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartFigure>
  )
}
