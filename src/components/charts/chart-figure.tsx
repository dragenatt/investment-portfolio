'use client'

import { useId, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import type { ChartTable } from '@/lib/utils/chart-accessibility'

/**
 * A chart with its text alternative (C5, WCAG 1.1.1).
 *
 * The drawing is hidden from assistive technology — an SVG of paths says
 * nothing useful read aloud — and replaced by `summary`, one sentence with what
 * the chart shows. When the chart plots data, `table` holds the same data
 * behind "Ver datos como tabla", open to everyone: screen-reader users,
 * keyboard users who cannot hover a tooltip, anyone who wants exact numbers.
 *
 * Charts inside set `accessibilityLayer={false}`: Recharts' layer makes the SVG
 * focusable, and a focusable element inside aria-hidden is a keyboard trap for
 * screen-reader users.
 */
export function ChartFigure({
  summary,
  table,
  children,
  className,
  fill = false,
}: {
  summary: string
  table?: ChartTable | null
  children: ReactNode
  className?: string
  /** For charts sized height="100%": the figure fills its parent and the chart takes what the table toggle leaves. */
  fill?: boolean
}) {
  const captionId = useId()
  return (
    <figure className={cn('m-0', fill && 'flex h-full flex-col', className)} aria-labelledby={captionId}>
      <div aria-hidden="true" className={cn(fill && 'min-h-0 flex-1')}>
        {children}
      </div>
      <figcaption id={captionId} className="sr-only">
        {summary}
      </figcaption>
      {table && table.rows.length > 0 && (
        <details className="mt-2">
          <summary className="w-fit cursor-pointer rounded text-xs text-muted-foreground hover:text-foreground">
            Ver datos como tabla
          </summary>
          <div className="mt-2 max-h-72 overflow-auto rounded-lg border border-border" tabIndex={0} role="region" aria-label={table.caption}>
            <table className="w-full text-xs">
              <caption className="sr-only">{table.caption}</caption>
              <thead className="sticky top-0 bg-card">
                <tr>
                  {table.columns.map((column, i) => (
                    <th
                      key={column}
                      scope="col"
                      className={cn('px-3 py-2 font-medium text-muted-foreground', i === 0 ? 'text-left' : 'text-right')}
                    >
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, r) => (
                  <tr key={r} className="border-t border-border">
                    {row.map((cell, c) =>
                      c === 0 ? (
                        <th key={c} scope="row" className="px-3 py-1.5 text-left font-normal">
                          {cell}
                        </th>
                      ) : (
                        <td key={c} className="px-3 py-1.5 text-right font-financial">
                          {cell}
                        </td>
                      ),
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {table.note && <p className="mt-1 text-xs text-muted-foreground">{table.note}</p>}
        </details>
      )}
    </figure>
  )
}
