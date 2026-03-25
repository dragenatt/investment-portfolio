'use client'

import { use } from 'react'
import { useQuote } from '@/lib/hooks/use-market'
import { usePortfolios } from '@/lib/hooks/use-portfolios'
import { useWatchlists } from '@/lib/hooks/use-watchlist'
import { PriceDisplay } from '@/components/market/price-display'
import { PriceChart } from '@/components/market/price-chart'
import { FundamentalsGrid } from '@/components/market/fundamentals-grid'
import { CompanyInfo } from '@/components/market/company-info'
import { EventsTimeline } from '@/components/market/events-timeline'
import { SkeletonCard } from '@/components/shared/skeleton-card'
import { ErrorBoundary } from '@/components/shared/error-boundary'
import { useFundamentals } from '@/lib/hooks/use-fundamentals'
import { useEvents } from '@/lib/hooks/use-events'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Plus, Eye, AlertCircle } from 'lucide-react'
import { toast } from 'sonner'
import { useSWRConfig } from 'swr'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'

export default function SymbolDetailPage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = use(params)
  const decodedSymbol = decodeURIComponent(symbol)
  const { data: quote, isLoading, error } = useQuote(decodedSymbol)
  const { data: fundamentals } = useFundamentals(decodedSymbol)
  const { data: events } = useEvents(decodedSymbol)
  const { data: portfolios } = usePortfolios()
  const { data: watchlists } = useWatchlists()
  const { mutate } = useSWRConfig()
  const router = useRouter()

  async function addToWatchlist(watchlistId: string) {
    const res = await fetch(`/api/watchlist/${watchlistId}/add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol: decodedSymbol, asset_type: 'stock' }),
    })
    const data = await res.json()
    if (data.error) toast.error(data.error)
    else { toast.success('Agregado a watchlist'); mutate('/api/watchlist') }
  }

  if (isLoading) return <SkeletonCard />

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4 rounded-2xl">
        <AlertCircle className="h-10 w-10 text-destructive" />
        <p className="text-lg font-medium">No se pudo cargar {decodedSymbol}</p>
        <p className="text-sm text-muted-foreground">{error.message}</p>
        <Button className="rounded-xl" variant="outline" onClick={() => mutate(`/api/market/${encodeURIComponent(decodedSymbol)}`)}>
          Reintentar
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <span className="text-primary font-bold">{decodedSymbol[0]}</span>
          </div>
          <h1 className="text-3xl font-bold font-mono">{decodedSymbol}</h1>
        </div>
        {quote && (
          <PriceDisplay
            price={quote.price}
            change={quote.change}
            changePct={quote.changePct}
            currency={quote.currency}
            size="lg"
          />
        )}

        <div className="flex gap-2 mt-4">
          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex items-center justify-center rounded-xl text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 h-9 px-3 gap-1">
              <Plus className="h-4 w-4" /> Agregar a Portafolio
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {portfolios?.map((p: { id: string; name: string }) => (
                <DropdownMenuItem key={p.id} onClick={() => router.push(`/portfolio/${p.id}/transactions?add=${encodeURIComponent(decodedSymbol)}`)}>
                  {p.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex items-center justify-center rounded-xl text-sm font-medium border border-input bg-background hover:bg-accent hover:text-accent-foreground h-9 px-3 gap-1">
              <Eye className="h-4 w-4" /> Agregar a Watchlist
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {watchlists?.map((wl: { id: string; name: string }) => (
                <DropdownMenuItem key={wl.id} onClick={() => addToWatchlist(wl.id)}>
                  {wl.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <ErrorBoundary>
        <PriceChart symbol={decodedSymbol} />
      </ErrorBoundary>

      {fundamentals && !fundamentals._partial && (
        <ErrorBoundary>
          <FundamentalsGrid
            marketCap={fundamentals.market_cap}
            peRatio={fundamentals.pe_ratio ? Number(fundamentals.pe_ratio) : null}
            eps={fundamentals.eps ? Number(fundamentals.eps) : null}
            dividendYield={fundamentals.dividend_yield ? Number(fundamentals.dividend_yield) : null}
            week52High={fundamentals.week52_high ? Number(fundamentals.week52_high) : null}
            week52Low={fundamentals.week52_low ? Number(fundamentals.week52_low) : null}
            currentPrice={quote?.price}
            analystRating={fundamentals.analyst_rating}
            analystTarget={fundamentals.analyst_target_price ? Number(fundamentals.analyst_target_price) : null}
          />
        </ErrorBoundary>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {fundamentals && fundamentals.description && (
          <div className="lg:col-span-2">
            <ErrorBoundary>
              <CompanyInfo
                name={fundamentals.name || decodedSymbol}
                description={fundamentals.description}
                ceo={fundamentals.ceo}
                employees={fundamentals.employees}
                hq={fundamentals.hq}
                website={fundamentals.website}
                sector={fundamentals.sector}
                industry={fundamentals.industry}
              />
            </ErrorBoundary>
          </div>
        )}
        <div className={fundamentals?.description ? 'lg:col-span-1' : 'lg:col-span-3'}>
          <ErrorBoundary>
            <EventsTimeline events={events ?? []} />
          </ErrorBoundary>
        </div>
      </div>
    </div>
  )
}
