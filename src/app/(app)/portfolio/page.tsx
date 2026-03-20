'use client'

import { usePortfolios } from '@/lib/hooks/use-portfolios'
import { PortfolioCard } from '@/components/portfolio/portfolio-card'
import { Button } from '@/components/ui/button'
import { SkeletonCard } from '@/components/shared/skeleton-card'
import { Plus } from 'lucide-react'
import Link from 'next/link'

export default function PortfolioListPage() {
  const { data: portfolios, isLoading } = usePortfolios()

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Portafolios</h1>
        <Link href="/portfolio/new">
          <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Nuevo Portafolio</Button>
        </Link>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2].map(i => <SkeletonCard key={i} />)}
        </div>
      ) : portfolios?.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-muted-foreground mb-4">No tienes portafolios aun</p>
          <Link href="/portfolio/new">
            <Button>Crear mi primer portafolio</Button>
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {portfolios?.map((p: Record<string, unknown>) => (
            <PortfolioCard key={p.id as string} id={p.id as string} name={p.name as string} description={p.description as string} positions={p.positions as []} />
          ))}
        </div>
      )}
    </div>
  )
}
