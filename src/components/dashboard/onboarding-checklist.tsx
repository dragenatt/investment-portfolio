'use client'

import { useSyncExternalStore } from 'react'
import Link from 'next/link'
import { Check, X, Briefcase, TrendingUp, Lightbulb } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/lib/i18n'

const DISMISSED_KEY = 'onboarding_checklist_dismissed'

/**
 * The dismissed flag lives in localStorage, which is an external store rather
 * than React state. It cannot be read during render — this component is
 * server-rendered and localStorage does not exist there — so useSyncExternalStore
 * is what reads it: getServerSnapshot keeps the card hidden through the server
 * render and the first client paint, so a returning user never sees it flash
 * before we know they dismissed it.
 *
 * Writing the key does not fire a `storage` event in the tab that wrote it, only
 * in other tabs, so dismiss() notifies local subscribers itself.
 */
const listeners = new Set<() => void>()

function subscribeToDismissed(onStoreChange: () => void) {
  listeners.add(onStoreChange)
  window.addEventListener('storage', onStoreChange)
  return () => {
    listeners.delete(onStoreChange)
    window.removeEventListener('storage', onStoreChange)
  }
}

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === 'true'
  } catch {
    return false
  }
}

/** Hidden until the client can tell us otherwise. */
function readDismissedOnServer(): boolean {
  return true
}

function dismissChecklist() {
  try {
    localStorage.setItem(DISMISSED_KEY, 'true')
  } catch {
    /* ignore */
  }
  listeners.forEach((notify) => notify())
}

type Props = {
  hasPortfolio: boolean
  hasPosition: boolean
  hasAdvisorProfile: boolean
}

export function OnboardingChecklist({ hasPortfolio, hasPosition, hasAdvisorProfile }: Props) {
  const { t } = useTranslation()
  const dismissed = useSyncExternalStore(
    subscribeToDismissed,
    readDismissed,
    readDismissedOnServer,
  )

  const allComplete = hasPortfolio && hasPosition && hasAdvisorProfile
  if (dismissed || allComplete) return null

  const steps = [
    { done: hasPortfolio, label: t.onboarding.step_portfolio, href: '/portfolio/new', icon: Briefcase },
    { done: hasPosition, label: t.onboarding.step_position, href: '/portfolio', icon: TrendingUp },
    { done: hasAdvisorProfile, label: t.onboarding.step_advisor, href: '/advisor', icon: Lightbulb },
  ]

  const completed = steps.filter(s => s.done).length

  return (
    <Card className="rounded-2xl border-border shadow-sm border-primary/20">
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <div className="flex items-center gap-3">
          <CardTitle className="text-base">{t.onboarding.checklist_title}</CardTitle>
          <span className="text-xs text-muted-foreground font-medium">
            {completed}/{steps.length}
          </span>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Ocultar primeros pasos" onClick={dismissChecklist}>
          <X className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent className="pt-0">
        {/* Progress bar */}
        <div
          className="h-1.5 rounded-full bg-secondary mb-4 overflow-hidden"
          role="progressbar"
          aria-label="Progreso de primeros pasos"
          aria-valuemin={0}
          aria-valuemax={steps.length}
          aria-valuenow={completed}
        >
          <div
            className="h-full rounded-full bg-primary transition-all duration-500"
            style={{ width: `${(completed / steps.length) * 100}%` }}
          />
        </div>

        <ul className="space-y-2" aria-label={`${completed} de ${steps.length} pasos completados`}>
          {steps.map((step) => {
            const Icon = step.icon
            const content = (
              <>
                <div
                  aria-hidden="true"
                  className={cn(
                    'h-7 w-7 rounded-full flex items-center justify-center shrink-0 transition-colors',
                    step.done
                      ? 'bg-primary/15 text-primary'
                      : 'border border-border text-muted-foreground'
                  )}
                >
                  {step.done ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <Icon className="h-3.5 w-3.5" />
                  )}
                </div>
                <span className={cn(
                  'text-sm font-medium',
                  step.done && 'line-through text-muted-foreground'
                )}>
                  {step.label}
                  {step.done && <span className="sr-only"> (completado)</span>}
                </span>
              </>
            )
            // A finished step is a statement, not a destination: it used to be a
            // link to "#" at 60% opacity, a dead tab stop whose text failed contrast.
            return (
              <li key={step.label}>
                {step.done ? (
                  <div className="flex items-center gap-3 p-2.5 rounded-xl">{content}</div>
                ) : (
                  <Link
                    href={step.href}
                    className="flex items-center gap-3 p-2.5 rounded-xl transition-colors hover:bg-secondary"
                  >
                    {content}
                  </Link>
                )}
              </li>
            )
          })}
        </ul>
      </CardContent>
    </Card>
  )
}
