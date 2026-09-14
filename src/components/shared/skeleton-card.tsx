import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent, CardHeader } from '@/components/ui/card'

export function SkeletonCard() {
  return (
    <Card className="rounded-2xl border-border" role="status" aria-busy="true">
      <span className="sr-only">Cargando…</span>
      <CardHeader className="pb-2" aria-hidden="true">
        <Skeleton className="h-4 w-24" />
      </CardHeader>
      <CardContent aria-hidden="true">
        <Skeleton className="h-8 w-32 mb-1" />
        <Skeleton className="h-4 w-16" />
      </CardContent>
    </Card>
  )
}
