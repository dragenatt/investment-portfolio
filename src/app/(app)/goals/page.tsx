'use client'

import Link from 'next/link'
import { Target, ChevronRight } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/shared/empty-state'
import { ErrorDisplay } from '@/components/shared/error-display'
import { SkeletonCard } from '@/components/shared/skeleton-card'
import { useGoals, GOAL_STATUS_LABELS, PACE_LABELS, type GoalWithTracking } from '@/lib/hooks/use-goals'
import { formatCurrency } from '@/lib/utils/currency'
import { cn } from '@/lib/utils'

// P1-8 / P1-9. Goals had a table, row-level security, a CRUD API and tracking
// maths — and no screen, so zero rows ever existed. This is the screen.

/** Pace as a word as well as a colour: C9 forbids colour as the only signal. */
const PACE_TONE: Record<string, string> = {
  ahead: 'text-gain',
  'on-track': 'text-foreground',
  behind: 'text-loss',
  unknown: 'text-muted-foreground',
}

function ProgressBar({ value, label }: { value: number; label: string }) {
  const clamped = Math.max(0, Math.min(100, value))
  return (
    <div
      className="h-2 w-full rounded-full bg-muted overflow-hidden"
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div className="h-full rounded-full bg-primary" style={{ width: `${clamped}%` }} />
    </div>
  )
}

function GoalCard({ goal }: { goal: GoalWithTracking }) {
  const tracking = goal.tracking
  const inactive = goal.status !== 'active'

  return (
    <Link href={`/goals/${goal.id}`} className="block group">
      <Card className={cn('rounded-2xl transition-colors group-hover:border-primary/40', inactive && 'opacity-70')}>
        <CardContent className="p-5 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="font-semibold truncate">{goal.name}</h2>
              <p className="text-xs text-muted-foreground">
                Meta de <span className="font-financial">{formatCurrency(Number(goal.target_amount), goal.currency)}</span> para el {goal.target_date}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Badge variant={goal.status === 'active' ? 'secondary' : 'outline'}>{GOAL_STATUS_LABELS[goal.status]}</Badge>
              <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            </div>
          </div>

          {tracking ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">
                  Avance <span className="font-financial">{tracking.progressPct.toFixed(1)}%</span> · tiempo transcurrido{' '}
                  <span className="font-financial">{tracking.timeElapsedPct.toFixed(0)}%</span>
                </span>
                <span className={cn('font-medium', PACE_TONE[tracking.pace])}>{PACE_LABELS[tracking.pace]}</span>
              </div>
              <ProgressBar value={tracking.progressPct} label={`Avance hacia ${goal.name}`} />
              <p className="text-xs text-muted-foreground">
                Hoy vale <span className="font-financial">{formatCurrency(tracking.currentValue, goal.currency)}</span>; el plan
                esperaba <span className="font-financial">{formatCurrency(tracking.expectedValue, goal.currency)}</span> a estas alturas.
              </p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              {goal.portfolio_id
                ? 'El portafolio vinculado no tiene posiciones con las que medir el avance.'
                : 'Meta sin portafolio vinculado: muestra el plan, no el avance real.'}
            </p>
          )}
        </CardContent>
      </Card>
    </Link>
  )
}

export default function GoalsPage() {
  const { data: goals, isLoading, error, mutate } = useGoals()

  if (error && !goals) {
    return <ErrorDisplay error="No se pudieron cargar tus metas. Tus datos no se han perdido." onRetry={() => mutate()} />
  }

  const active = (goals ?? []).filter((goal) => goal.status === 'active')
  const others = (goals ?? []).filter((goal) => goal.status !== 'active')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Metas</h1>
        <p className="text-sm text-muted-foreground">
          Tus planes guardados y cómo van contra lo que proyectaban. El avance se compara con la curva del propio
          plan, no con una línea recta: el interés compuesto concentra el crecimiento al final.
        </p>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : (goals ?? []).length === 0 ? (
        <EmptyState
          icon={Target}
          title="Todavía no tienes metas"
          description="Haz un análisis en el Asesor y guárdalo como meta para seguir su avance aquí."
          action={{ label: 'Ir al Asesor', href: '/advisor' }}
        />
      ) : (
        <>
          {active.length > 0 && (
            <section className="space-y-3" aria-labelledby="goals-active">
              <h2 id="goals-active" className="text-sm font-medium text-muted-foreground">Activas</h2>
              <div className="grid gap-4 md:grid-cols-2">
                {active.map((goal) => <GoalCard key={goal.id} goal={goal} />)}
              </div>
            </section>
          )}
          {others.length > 0 && (
            <section className="space-y-3" aria-labelledby="goals-other">
              <h2 id="goals-other" className="text-sm font-medium text-muted-foreground">Alcanzadas, pausadas y canceladas</h2>
              <div className="grid gap-4 md:grid-cols-2">
                {others.map((goal) => <GoalCard key={goal.id} goal={goal} />)}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}
