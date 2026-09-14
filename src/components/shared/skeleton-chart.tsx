import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent, CardHeader } from '@/components/ui/card'

export function SkeletonChart() {
  return (
    // role=status + hidden text: the grey blocks say nothing to a screen reader (C9).
    <Card className="rounded-2xl border-border" role="status" aria-busy="true">
      <span className="sr-only">Cargando gráfica…</span>
      <CardHeader className="pb-2" aria-hidden="true">
        <Skeleton className="h-4 w-32" />
      </CardHeader>
      <CardContent aria-hidden="true">
        <Skeleton className="h-[250px] w-full rounded-xl" />
      </CardContent>
    </Card>
  )
}
