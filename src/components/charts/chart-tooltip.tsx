'use client'

import type { ReactNode } from 'react'

/**
 * The tooltip every chart shows (D12).
 *
 * Charts with their own tooltip content keep it and put it inside the
 * `chart-tooltip` utility (globals.css): same surface, border, radius, shadow
 * and type size everywhere, in both themes. Charts that used Recharts' default
 * tooltip — white in dark mode, its own font, unformatted numbers — use this
 * component instead.
 */

type Entry = {
  name?: string | number
  value?: unknown
  color?: string
  dataKey?: string | number
  payload?: Record<string, unknown>
}

export type ChartTooltipContentProps = {
  active?: boolean
  payload?: Entry[]
  label?: string | number
  /** Title line; omitted when it returns null. */
  labelFormatter?: (label: string | number | undefined, entries: Entry[]) => ReactNode
  /** How each value reads. Required: raw floats are never shown. */
  valueFormatter: (value: unknown, entry: Entry) => string
  /** Series name as the reader should see it. */
  nameFormatter?: (name: string, entry: Entry) => string
}

export function ChartTooltipContent({
  active,
  payload,
  label,
  labelFormatter,
  valueFormatter,
  nameFormatter,
}: ChartTooltipContentProps) {
  if (!active || !payload || payload.length === 0) return null
  const title = labelFormatter ? labelFormatter(label, payload) : label

  return (
    <div className="chart-tooltip space-y-1 max-w-72">
      {title !== null && title !== undefined && title !== '' && (
        <p className="text-muted-foreground">{title}</p>
      )}
      {payload.map((entry, index) => {
        const name = String(entry.name ?? entry.dataKey ?? '')
        return (
          <div key={`${name}-${index}`} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              {entry.color && (
                <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full" style={{ background: entry.color }} />
              )}
              {nameFormatter ? nameFormatter(name, entry) : name}
            </span>
            <span className="font-financial font-medium text-foreground">{valueFormatter(entry.value, entry)}</span>
          </div>
        )
      })}
    </div>
  )
}
