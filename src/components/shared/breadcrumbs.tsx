'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import useSWR from 'swr'
import { ChevronRight } from 'lucide-react'
import { apiFetcher } from '@/lib/api/fetcher'

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
  history: 'Historial',
  goals: 'Metas',
  costs: 'Costos',
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * What a record's id is called on screen.
 *
 * The trail used to print the raw id — "Portafolios › ae9f2d48-bdc4-… ›
 * Análisis" — which tells the reader nothing and is the one thing on the page
 * they cannot recognise. The name is asked for only on a page that shows a
 * record, and SWR shares the answer with the page's own request rather than
 * making a second one. Until it arrives the crumb says what kind of thing it
 * is, never the id.
 */
function useRecordName(segments: string[]): { id: string; name: string | null; fallback: string } | null {
  const [section, id] = segments
  const isPortfolio = section === 'portfolio' && UUID.test(id ?? '')
  const isGoal = section === 'goals' && UUID.test(id ?? '')

  const { data: portfolios } = useSWR<Array<{ id: string; name: string }>>(
    isPortfolio ? '/api/portfolio' : null,
    apiFetcher,
    { revalidateOnFocus: false },
  )
  const { data: goal } = useSWR<{ name: string }>(isGoal ? `/api/goals/${id}` : null, apiFetcher, {
    revalidateOnFocus: false,
  })

  if (isPortfolio) return { id, name: portfolios?.find((p) => p.id === id)?.name ?? null, fallback: 'Portafolio' }
  if (isGoal) return { id, name: goal?.name ?? null, fallback: 'Meta' }
  return null
}

export function Breadcrumbs() {
  const pathname = usePathname()
  const segments = pathname.split('/').filter(Boolean)
  const record = useRecordName(segments)

  if (segments.length <= 1) return null

  const crumbs = segments.map((segment: string, i: number) => {
    const href = '/' + segments.slice(0, i + 1).join('/')
    const decoded = decodeURIComponent(segment)
    const named = record && segment === record.id ? record.name ?? record.fallback : null
    const label = named || LABELS[segment] || SYMBOL_NAMES[segment] || SYMBOL_NAMES[decoded] || decoded
    const isLast = i === segments.length - 1
    return { href, label, isLast }
  })

  return (
    <nav aria-label="Ruta de navegación" className="flex items-center gap-1 text-sm text-muted-foreground mb-4">
      {crumbs.map((crumb: { href: string; label: string; isLast: boolean }, i: number) => (
        <span key={crumb.href} className="flex items-center gap-1">
          {i > 0 && <ChevronRight aria-hidden="true" className="h-3 w-3" />}
          {crumb.isLast ? (
            <span aria-current="page" className="text-foreground font-medium">{crumb.label}</span>
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
