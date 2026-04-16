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

const SYMBOL_NAMES: Record<string, string> = {
  '^GSPC': 'S&P 500',
  '%5EGSPC': 'S&P 500',
  '^DJI': 'Dow Jones',
  '%5EDJI': 'Dow Jones',
  '^IXIC': 'Nasdaq',
  '%5EIXIC': 'Nasdaq',
  '^N225': 'Nikkei 225',
  '%5EN225': 'Nikkei 225',
  '^FTSE': 'FTSE 100',
  '%5EFTSE': 'FTSE 100',
  '^RUT': 'Russell 2000',
  '%5ERUT': 'Russell 2000',
}

export function Breadcrumbs() {
  const pathname = usePathname()
  const segments = pathname.split('/').filter(Boolean)

  if (segments.length <= 1) return null

  const crumbs = segments.map((segment: string, i: number) => {
    const href = '/' + segments.slice(0, i + 1).join('/')
    const decoded = decodeURIComponent(segment)
    const label = LABELS[segment] || SYMBOL_NAMES[segment] || SYMBOL_NAMES[decoded] || decoded
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
