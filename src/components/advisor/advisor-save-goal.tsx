'use client'

import { useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { BookmarkPlus, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { usePortfolios } from '@/lib/hooks/use-portfolios'
import { goalActions } from '@/lib/hooks/use-goals'
import { goalDraftFromAdvisor, type RiskProfileName } from '@/lib/services/goal-drafts'
import type { PlanOutcome, PlanParams } from '@/lib/services/advisor'

// P1-8. The advisor answered "will I get there?" and the answer disappeared the
// moment the page closed. This keeps it: the plan as a goal, and what the model
// said about it as the goal's first projection, both from the exact numbers on
// screen — goalDraftFromAdvisor is pure and tested for that reason.

type Props = {
  params: PlanParams
  target: number
  outcome: PlanOutcome
  requiredContribution: number | null
  riskProfile: RiskProfileName
}

export function GuardarComoMeta({ params, target, outcome, requiredContribution, riskProfile }: Props) {
  const { data: portfolios } = usePortfolios()
  const [name, setName] = useState('')
  const [portfolioId, setPortfolioId] = useState('')
  const [saving, setSaving] = useState(false)
  const [savedId, setSavedId] = useState<string | null>(null)

  if (!(target > 0)) {
    return (
      <div className="premium-card p-6">
        <h3 className="font-semibold mb-1">Guardar como meta</h3>
        <p className="text-sm text-muted-foreground">
          Este análisis no tiene una meta, así que no hay nada que seguir. Indica una cantidad objetivo en el último
          paso para poder guardarlo.
        </p>
      </div>
    )
  }

  const save = async () => {
    const draft = goalDraftFromAdvisor({
      name,
      currency: 'MXN',
      riskProfile,
      params,
      target,
      outcome,
      requiredContribution,
      portfolioId: portfolioId || null,
      today: new Date(),
    })
    if (!draft) {
      toast.error('Ponle un nombre a la meta para guardarla.')
      return
    }

    setSaving(true)
    try {
      const saved = await goalActions.create({ ...draft.goal, projection: draft.projection })
      setSavedId(saved.id)
      toast.success(
        saved.projection_saved === false
          ? 'Meta guardada, pero no se pudo guardar su proyección inicial.'
          : 'Meta guardada con su proyección.',
      )
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo guardar la meta')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="premium-card p-6 space-y-4">
      <div>
        <h3 className="font-semibold mb-1">Guardar como meta</h3>
        <p className="text-sm text-muted-foreground">
          Guarda este plan para seguir cómo va con el tiempo. Se guarda tal como está en pantalla, junto con lo que el
          modelo estimó hoy, y cada recálculo posterior se añade al historial en lugar de reemplazarlo.
        </p>
      </div>

      {savedId ? (
        <p className="flex items-center gap-2 text-sm">
          <Check className="h-4 w-4 text-gain" aria-hidden="true" />
          Guardada.{' '}
          <Link href={`/goals/${savedId}`} className="underline underline-offset-4">
            Ver la meta
          </Link>
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <div className="space-y-1">
            <Label htmlFor="goal-name">Nombre</Label>
            <Input
              id="goal-name"
              value={name}
              maxLength={120}
              placeholder="Ej. Enganche de casa"
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="goal-portfolio">Seguir con un portafolio (opcional)</Label>
            <select
              id="goal-portfolio"
              value={portfolioId}
              onChange={(e) => setPortfolioId(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
            >
              <option value="">Sin portafolio: solo el plan</option>
              {(portfolios ?? []).map((p: { id: string; name: string }) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <Button onClick={save} disabled={saving || name.trim().length === 0}>
            <BookmarkPlus className="h-4 w-4 mr-1" aria-hidden="true" />
            {saving ? 'Guardando…' : 'Guardar meta'}
          </Button>
        </div>
      )}
    </div>
  )
}
