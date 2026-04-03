'use client'

import { usePortfolios } from '@/lib/hooks/use-portfolios'
import { useLivePrices } from '@/lib/hooks/use-live-prices'
import { PortfolioCard } from '@/components/portfolio/portfolio-card'
import { Button } from '@/components/ui/button'
import { SkeletonCard } from '@/components/shared/skeleton-card'
import { EmptyState } from '@/components/shared/empty-state'
import { ErrorDisplay } from '@/components/shared/error-display'
import { Plus, Briefcase, Upload } from 'lucide-react'
import Link from 'next/link'
import { useMemo, useCallback } from 'react'
import { useTranslation } from '@/lib/i18n'
import { useRouter } from 'next/navigation'

export default function PortfolioListPage() {
  const { t } = useTranslation()
  const router = useRouter()
  const { data: portfolios, isLoading, error, mutate } = usePortfolios()

  const allSymbols = useMemo(() => {
    if (!portfolios) return []
    const symbols: string[] = []
    for (const p of portfolios) {
      for (const pos of p.positions || []) {
        if (pos.quantity > 0) symbols.push(pos.symbol)
      }
    }
    return symbols
  }, [portfolios])

  const { data: livePrices } = useLivePrices(allSymbols)

  const handleRetry = useCallback(() => {
    // If it's an auth error, redirect to login instead of retrying
    const msg = error?.message || ''
    if (msg.includes('Unauthorized') || msg.includes('401') || msg.includes('Sesión expirada')) {
      router.push('/login')
      return
    }
    // Otherwise, re-fetch the data without a full page reload
    mutate()
  }, [error, router, mutate])

  if (error) return <ErrorDisplay error={t.portfolio.error_loading} onRetry={handleRetry} />

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">{t.portfolio.title}</h1>
        <div className="flex items-center gap-2">
          <Link href="/portfolio/import">
            <Button variant="outline" className="rounded-xl" size="sm"><Upload className="h-4 w-4 mr-1" /> {t.portfolio.import_csv}</Button>
          </Link>
          <Link href="/portfolio/new">
            <Button className="rounded-xl bg-primary text-primary-foreground" size="sm"><Plus className="h-4 w-4 mr-1" /> {t.portfolio.new_portfolio}</Button>
          </Link>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2].map(i => <SkeletonCard key={i} />)}
        </div>
      ) : portfolios?.length === 0 ? (
        <EmptyState
          icon={Briefcase}
          title={t.portfolio.no_portfolios}
          description={t.portfolio.no_portfolios_desc}
          action={{ label: t.portfolio.create_first, href: '/portfolio/new' }}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {portfolios?.map((p: Record<string, unknown>) => (
            <PortfolioCard key={p.id as string} id={p.id as string} name={p.name as string} description={p.description as string} positions={p.positions as []} livePrices={livePrices} onMutate={mutate} />
          ))}
        </div>
      )}
    </div>
  )
}
