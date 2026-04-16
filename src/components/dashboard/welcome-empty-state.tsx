'use client'

import Link from 'next/link'
import { Briefcase, Lightbulb, TrendingUp } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/lib/i18n'

export function WelcomeEmptyState() {
  const { t } = useTranslation()

  return (
    <Card className="rounded-2xl border-border shadow-sm">
      <CardContent className="flex flex-col items-center justify-center py-16 px-6">
        <div className="p-5 rounded-2xl bg-gradient-to-br from-primary/15 to-primary/5 mb-6">
          <TrendingUp className="h-10 w-10 text-primary" />
        </div>
        <h2 className="text-2xl font-bold mb-2 text-center">
          {t.onboarding.welcome_title}
        </h2>
        <p className="text-muted-foreground text-center max-w-md mb-8">
          {t.onboarding.welcome_desc}
        </p>
        <div className="flex flex-col sm:flex-row gap-3">
          <Link href="/portfolio/new">
            <Button className="rounded-xl gap-2" size="lg">
              <Briefcase className="h-4 w-4" />
              {t.onboarding.create_portfolio}
            </Button>
          </Link>
          <Link href="/advisor">
            <Button variant="outline" className="rounded-xl gap-2" size="lg">
              <Lightbulb className="h-4 w-4" />
              {t.onboarding.complete_profile}
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  )
}
