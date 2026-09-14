import { Skeleton } from '@/components/ui/skeleton'

export function SkeletonTable({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3" role="status" aria-busy="true">
      <span className="sr-only">Cargando tabla…</span>
      <div className="flex gap-4" aria-hidden="true">
        {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-4 flex-1" />)}
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-4" aria-hidden="true">
          {[1, 2, 3, 4, 5].map(j => <Skeleton key={j} className="h-8 flex-1" />)}
        </div>
      ))}
    </div>
  )
}
