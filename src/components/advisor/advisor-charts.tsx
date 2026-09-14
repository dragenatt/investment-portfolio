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
  colors: string[]
}) {
  const DONUT_COLORS = colors
  return (
    <ResponsiveContainer width="100%" height={250}>
      <PieChart>
        <Pie
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
        <Tooltip
          formatter={(value) => `${value}%`}
          contentStyle={{
            borderRadius: '12px',
            border: '1px solid var(--border)',
            background: 'var(--card)',
          }}
        />
        <Legend />
      </PieChart>
    </ResponsiveContainer>
  )
}

export function AdvisorProjectionChart({
  chartData,
  fmt,
}: {
  chartData: ProjectionDatum[]
  fmt: Intl.NumberFormat
}) {
  return (
    <ResponsiveContainer width="100%" height={320}>
      <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis dataKey="name" tick={{ fontSize: 12 }} stroke="var(--muted-foreground)" />
        <YAxis
          tickFormatter={(v: number) => fmt.format(v)}
          tick={{ fontSize: 11 }}
          stroke="var(--muted-foreground)"
          width={90}
        />
        <Tooltip
          formatter={(value: unknown, name) => {
            if (Array.isArray(value)) {
              return [`${fmt.format(Number(value[0]))} – ${fmt.format(Number(value[1]))}`, name]
            }
            return [fmt.format(Number(value)), name]
          }}
          contentStyle={{
            borderRadius: '12px',
            border: '1px solid var(--border)',
            background: 'var(--card)',
          }}
          labelStyle={{ fontWeight: 600 }}
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
  )
}
