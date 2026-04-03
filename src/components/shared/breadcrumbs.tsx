'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'

const LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  portfolio: 'Portafolios',
  market: 'Mercados',
  watchlist: 'Watchlist',
  alerts: 'Alertas',
  settings: 'Configuración',
  transactions: 'Transacciones',
  analytics: 'Análisis',
  import: 'Importar',
  new: 'Nuevo',
}

export function Breadcrumbs() {
  const pathname = usePathname()
  const segments = pathname.split('/').filter(Boolean)

  if (segments.length <= 1) return null

  const crumbs = segments.map((segment: string, i: number) => {
    const href = '/' + segments.slice(0, i + 1).join('/')
    const label = LABELS[segment] || decodeURIComponent(segment)
    const isLast = i === segments.length - 1
    return { href, label, isLast }
  })

  return (
    <nav className="flex items-center gap-1 text-sm text-muted-foreground mb-4">
      {crumbs.map((crumb: { href: string; label: string; isLast: boolean }, i: number) => (
        <span key={crumb.href} className="flex items-center gap-1">
          {i > 0 && <ChevronRight className="h-3 w-3" />}
          {crumb.isLast ? (
            <span className="text-foreground font-medium">{crumb.label}</span>
          ) : (
            <Link href={crumb.href} className="hover:text-foreground transition-colors">
              {crumb.label}
            </Link>
          )}
        </span>
      ))}
    </nav>
  )
}
