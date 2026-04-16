'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Check, X, Briefcase, TrendingUp, Lightbulb } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/lib/i18n'

const DISMISSED_KEY = 'onboarding_checklist_dismissed'

type Props = {
  hasPortfolio: boolean
  hasPosition: boolean
  hasAdvisorProfile: boolean
}

export function OnboardingChecklist({ hasPortfolio, hasPosition, hasAdvisorProfile }: Props) {
  const { t } = useTranslation()
  const [dismissed, setDismissed] = useState(true) // start hidden to avoid flash

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(DISMISSED_KEY) === 'true')
    } catch {
      setDismissed(false)
    }
  }, [])

  const allComplete = hasPortfolio && hasPosition && hasAdvisorProfile
  if (dismissed || allComplete) return null

  function handleDismiss() {
    setDismissed(true)
    try { localStorage.setItem(DISMISSED_KEY, 'true') } catch { /* ignore */ }
  }

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
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleDismiss}>
          <X className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent className="pt-0">
        {/* Progress bar */}
        <div className="h-1.5 rounded-full bg-secondary mb-4 overflow-hidden">
          <div
            className="h-full rounded-full bg-primary transition-all duration-500"
            style={{ width: `${(completed / steps.length) * 100}%` }}
          />
        </div>

        <div className="space-y-2">
          {steps.map((step) => {
            const Icon = step.icon
            return (
              <Link
                key={step.label}
                href={step.done ? '#' : step.href}
                className={cn(
                  'flex items-center gap-3 p-2.5 rounded-xl transition-colors',
                  step.done
                    ? 'opacity-60'
                    : 'hover:bg-secondary cursor-pointer'
                )}
              >
                <div className={cn(
                  'h-7 w-7 rounded-full flex items-center justify-center shrink-0 transition-colors',
                  step.done
                    ? 'bg-primary/15 text-primary'
                    : 'border border-border text-muted-foreground'
                )}>
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
                </span>
              </Link>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
