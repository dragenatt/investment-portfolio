'use client'

import { use, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ArrowLeft, Copy, Pause, Play, RefreshCw, Trash2, Trophy, XCircle } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ErrorDisplay } from '@/components/shared/error-display'
import { SkeletonCard } from '@/components/shared/skeleton-card'
import { isNotFound } from '@/lib/api/fetcher'
import { useGoal, goalActions, GOAL_STATUS_LABELS, PACE_LABELS, type GoalStatus } from '@/lib/hooks/use-goals'
import { projectionForGoal } from '@/lib/services/goal-drafts'
import { buildScenarios, evaluarPlan, aporteParaProbabilidadMeta } from '@/lib/services/advisor'
import { formatCurrency } from '@/lib/utils/currency'
import { cn } from '@/lib/utils'

const ENGINE = { buildScenarios, evaluarPlan, aporteParaProbabilidadMeta }

const PACE_TONE: Record<string, string> = {
  ahead: 'text-gain',
  'on-track': 'text-foreground',
  behind: 'text-loss',
  unknown: 'text-muted-foreground',
}

function Figure({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-muted/50 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold font-financial">{children}</p>
    </div>
  )
}

export default function GoalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const { data, error, isLoading, mutate } = useGoal(id)
  const [busy, setBusy] = useState<string | null>(null)

  if (error && isNotFound(error)) {
    return <ErrorDisplay error="Esta meta no existe o no es tuya." />
  }
  if (error && !data) {
    return <ErrorDisplay error="No se pudo cargar la meta. Tus datos no se han perdido." onRetry={() => mutate()} />
  }
  if (isLoading || !data) {
    return (
      <div className="space-y-4">
        <SkeletonCard />
        <SkeletonCard />
      </div>
    )
  }

  const { goal, projections, tracking } = data
  const money = (value: number | null | undefined) =>
    value === null || value === undefined || !Number.isFinite(value) ? '—' : formatCurrency(value, goal.currency)

  const run = async (label: string, action: () => Promise<unknown>, done: string) => {
    setBusy(label)
    try {
      await action()
      toast.success(done)
      await mutate()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo completar la acción')
    } finally {
      setBusy(null)
    }
  }

  const setStatus = (status: GoalStatus, done: string) =>
    run(status, () => goalActions.update(goal.id, { status }), done)

  const recalculate = () =>
    run(
      'recalculate',
      async () => {
        const projection = projectionForGoal(goal, new Date(), tracking?.currentValue ?? null, ENGINE)
        if (!projection) throw new Error('No hay nada que proyectar: la fecha objetivo ya pasó o faltan los supuestos de rendimiento.')
        await goalActions.addProjection(goal.id, projection)
      },
      'Proyección añadida al historial',
    )

  const duplicate = () =>
    run('duplicate', async () => {
      const copy = await goalActions.duplicate(goal.id)
      router.push(`/goals/${copy.id}`)
    }, 'Meta duplicada')

  const remove = async () => {
    if (!window.confirm(`¿Eliminar "${goal.name}" y todo su historial de proyecciones? Esto no se puede deshacer.`)) return
    await run('delete', async () => {
      await goalActions.remove(goal.id)
      router.push('/goals')
    }, 'Meta eliminada')
  }

  const latest = projections[0] ?? null

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Link href="/goals" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Metas
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">{goal.name}</h1>
            <p className="text-sm text-muted-foreground">
              <span className="font-financial">{money(Number(goal.target_amount))}</span> del {goal.start_date} al {goal.target_date}
              {goal.risk_profile ? ` · perfil ${goal.risk_profile}` : ''}
            </p>
            {goal.description && <p className="text-sm mt-1">{goal.description}</p>}
          </div>
          <Badge variant={goal.status === 'active' ? 'secondary' : 'outline'}>{GOAL_STATUS_LABELS[goal.status]}</Badge>
        </div>
      </div>

      {/* Avance real contra el plan */}
      <Card className="rounded-2xl">
        <CardHeader>
          <CardTitle className="text-sm font-medium">Avance contra el plan</CardTitle>
          <CardDescription>
            Se compara con la curva del propio plan a esta fecha, no con una línea recta: al principio de un plan
            con interés compuesto lo esperado es bastante menos que la parte proporcional de la meta.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {tracking ? (
            <>
              <div className="flex items-center justify-between">
                <p className={cn('font-semibold', PACE_TONE[tracking.pace])}>{PACE_LABELS[tracking.pace]}</p>
                <p className="text-xs text-muted-foreground">
                  <span className="font-financial">{tracking.monthsElapsed}</span> meses transcurridos ·{' '}
                  <span className="font-financial">{tracking.monthsRemaining}</span> restantes
                </p>
              </div>
              <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
                <Figure label="Valor hoy">{money(tracking.currentValue)}</Figure>
                <Figure label="El plan esperaba hoy">{money(tracking.expectedValue)}</Figure>
                <Figure label="Diferencia">
                  <span className={cn('font-financial', tracking.deviation < 0 ? 'text-loss' : tracking.deviation > 0 ? 'text-gain' : '')}>
                    {tracking.deviation > 0 ? '+' : ''}{money(tracking.deviation)} ({tracking.deviationPct > 0 ? '+' : ''}{tracking.deviationPct.toFixed(1)}%)
                  </span>
                </Figure>
                <Figure label="Avance hacia la meta"><span className="font-financial">{tracking.progressPct.toFixed(1)}%</span></Figure>
                <Figure label="Aportado a la fecha">{money(tracking.contributedToDate)}</Figure>
                <Figure label="El plan preveía aportar">{money(tracking.plannedContributedToDate)}</Figure>
                <Figure label="Tiempo transcurrido"><span className="font-financial">{tracking.timeElapsedPct.toFixed(0)}%</span></Figure>
                <Figure label="¿Meta alcanzada?">{tracking.reached ? 'Sí' : 'Todavía no'}</Figure>
              </div>
              <p className="text-sm">{tracking.message}</p>
              {tracking.unconverted.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  No se pudo convertir a {goal.currency} el valor de {tracking.unconverted.join(', ')}; esas posiciones
                  se sumaron en su propia moneda.
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              {goal.portfolio_id
                ? 'El portafolio vinculado no tiene posiciones con las que medir el avance.'
                : 'Esta meta no está vinculada a un portafolio, así que solo existe el plan: no hay avance real que medir.'}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Acciones */}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={recalculate} disabled={busy !== null}>
          <RefreshCw className="h-4 w-4 mr-1" aria-hidden="true" /> Recalcular probabilidad
        </Button>
        {goal.status === 'active' ? (
          <Button variant="outline" size="sm" onClick={() => setStatus('paused', 'Meta pausada')} disabled={busy !== null}>
            <Pause className="h-4 w-4 mr-1" aria-hidden="true" /> Pausar
          </Button>
        ) : goal.status === 'paused' ? (
          <Button variant="outline" size="sm" onClick={() => setStatus('active', 'Meta reactivada')} disabled={busy !== null}>
            <Play className="h-4 w-4 mr-1" aria-hidden="true" /> Reactivar
          </Button>
        ) : null}
        {goal.status !== 'reached' && (
          <Button variant="outline" size="sm" onClick={() => setStatus('reached', 'Meta marcada como alcanzada')} disabled={busy !== null}>
            <Trophy className="h-4 w-4 mr-1" aria-hidden="true" /> Marcar alcanzada
          </Button>
        )}
        {goal.status !== 'cancelled' && (
          <Button variant="outline" size="sm" onClick={() => setStatus('cancelled', 'Meta cancelada')} disabled={busy !== null}>
            <XCircle className="h-4 w-4 mr-1" aria-hidden="true" /> Cancelar
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={duplicate} disabled={busy !== null}>
          <Copy className="h-4 w-4 mr-1" aria-hidden="true" /> Duplicar
        </Button>
        <Button variant="outline" size="sm" onClick={remove} disabled={busy !== null}>
          <Trash2 className="h-4 w-4 mr-1" aria-hidden="true" /> Eliminar
        </Button>
      </div>

      {/* Historial de proyecciones — nunca se sobrescribe */}
      <Card className="rounded-2xl">
        <CardHeader>
          <CardTitle className="text-sm font-medium">Historial de proyecciones</CardTitle>
          <CardDescription>
            Cada fila es lo que el modelo estimó en esa fecha, con la versión y la semilla que lo produjeron. Recalcular
            añade una fila; ninguna se edita ni se borra, para que puedas ver si la probabilidad cambió por tu avance,
            por el mercado o porque el propio modelo se corrigió. Una misma meta usa siempre los mismos escenarios
            aleatorios, así que un cambio de probabilidad entre filas no es suerte.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {projections.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin proyecciones todavía. Pulsa «Recalcular probabilidad».</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">Proyecciones de la meta, de la más reciente a la más antigua</caption>
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th scope="col" className="py-2 pr-3 font-medium">Fecha</th>
                    <th scope="col" className="py-2 pr-3 font-medium">Probabilidad</th>
                    <th scope="col" className="py-2 pr-3 font-medium">Pesimista (P10)</th>
                    <th scope="col" className="py-2 pr-3 font-medium">Mediana</th>
                    <th scope="col" className="py-2 pr-3 font-medium">Favorable (P90)</th>
                    <th scope="col" className="py-2 pr-3 font-medium">Aporte para 75%</th>
                    <th scope="col" className="py-2 font-medium">Modelo</th>
                  </tr>
                </thead>
                <tbody>
                  {projections.map((p) => (
                    <tr key={p.id} className="border-t border-border">
                      <td className="py-2 pr-3">{p.created_at.slice(0, 10)}</td>
                      <td className="py-2 pr-3 font-financial">{p.probability_pct === null ? '—' : `${Number(p.probability_pct).toFixed(1)}%`}</td>
                      <td className="py-2 pr-3 font-financial">{money(p.p10_final)}</td>
                      <td className="py-2 pr-3 font-financial">{money(p.p50_final)}</td>
                      <td className="py-2 pr-3 font-financial">{money(p.p90_final)}</td>
                      <td className="py-2 pr-3 font-financial">{money(p.required_contribution)}</td>
                      <td className="py-2 text-xs text-muted-foreground">v{p.model_version} · semilla {p.seed ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {latest && (
            <p className="mt-3 text-xs text-muted-foreground">
              Los resultados son escenarios simulados bajo los supuestos del plan, no predicciones garantizadas.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
