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
import { useMemo } from 'react'

export default function PortfolioListPage() {
  const { data: portfolios, isLoading, error } = usePortfolios()

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

  if (error) return <ErrorDisplay error="Error al cargar portafolios. Intenta recargar la pagina." onRetry={() => window.location.reload()} />

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Portafolios</h1>
        <div className="flex items-center gap-2">
          <Link href="/portfolio/import">
            <Button variant="outline" className="rounded-xl" size="sm"><Upload className="h-4 w-4 mr-1" /> Importar CSV</Button>
          </Link>
          <Link href="/portfolio/new">
            <Button className="rounded-xl bg-primary text-primary-foreground" size="sm"><Plus className="h-4 w-4 mr-1" /> Nuevo Portafolio</Button>
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
          title="Sin portafolios"
          description="Crea tu primer portafolio para empezar a registrar tus inversiones y hacer seguimiento de tu rendimiento."
          action={{ label: 'Crear mi primer portafolio', href: '/portfolio/new' }}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {portfolios?.map((p: Record<string, unknown>) => (
            <PortfolioCard key={p.id as string} id={p.id as string} name={p.name as string} description={p.description as string} positions={p.positions as []} livePrices={livePrices} />
          ))}
        </div>
      )}
    </div>
  )
}
