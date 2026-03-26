// Shared Recharts configuration factory
//
// Usage:
// const config = getChartTheme()
// <Tooltip {...config.tooltip} />
// <XAxis {...config.xAxis} />

export function getChartTheme() {
  return {
    xAxis: {
      tick: { fontSize: 11 } as Record<string, unknown>,
      tickLine: false as const,
      axisLine: false as const,
    },
    yAxis: {
      tick: { fontSize: 11 } as Record<string, unknown>,
      tickLine: false as const,
      axisLine: false as const,
      width: 60,
    },
    colors: {
      primary: '#D97706',
      positive: '#16a34a',
      negative: '#dc2626',
      palette: ['#D97706', '#4D7C0F', '#B45309', '#78716C', '#C2410C', '#92400E'],
      benchmarks: ['#2563eb', '#16a34a', '#f59e0b', '#ef4444'],
    },
  } as const
}

/** Helper to format axis tick values */
export function formatAxisTick(
  value: number,
  type: 'currency' | 'percent' | 'number',
): string {
  switch (type) {
    case 'currency':
      return `$${value.toLocaleString()}`
    case 'percent':
      return `${value}%`
    case 'number':
      return value.toLocaleString()
  }
}

// Re-export a convenience type for the theme object
export type ChartTheme = ReturnType<typeof getChartTheme>
