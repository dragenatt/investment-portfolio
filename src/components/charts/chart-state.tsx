'use client'

import { AlertCircle, LineChart } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

/**
 * Loading and empty states that sit where a chart will be (D12).
 *
 * Same height as the chart, so nothing jumps when the data arrives; announced
 * to screen readers, since a grey block or a blank area says nothing. An error
 * is not an empty state: it says the data could not be loaded, and offers a
 * retry when the caller can do one (C9).
 */

export function ChartLoading({ height, label = 'Cargando gráfica…', className }: { height: number; label?: string; className?: string }) {
  return (
    <div role="status" aria-busy="true" className={cn('w-full', className)} style={{ height }}>
      <span className="sr-only">{label}</span>
      <Skeleton aria-hidden="true" className="h-full w-full rounded-xl" />
    </div>
  )
}

export function ChartEmpty({
  height,
  message,
  kind = 'empty',
  onRetry,
  className,
}: {
  height: number
  message: string
  kind?: 'empty' | 'error'
  onRetry?: () => void
  className?: string
}) {
  const Icon = kind === 'error' ? AlertCircle : LineChart
  return (
    <div
      role={kind === 'error' ? 'alert' : 'status'}
      className={cn('flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border text-center', className)}
      style={{ height }}
    >
      <Icon aria-hidden="true" className={cn('h-5 w-5', kind === 'error' ? 'text-destructive' : 'text-muted-foreground')} />
      <p className="max-w-xs text-sm text-muted-foreground">{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="text-sm font-medium text-primary underline underline-offset-4">
          Reintentar
        </button>
      )}
    </div>
  )
}
