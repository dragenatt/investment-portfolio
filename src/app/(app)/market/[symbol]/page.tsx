'use client'

import { use, useState, useMemo } from 'react'
import { useQuote } from '@/lib/hooks/use-market'
import { usePortfolios } from '@/lib/hooks/use-portfolios'
import { useWatchlists } from '@/lib/hooks/use-watchlist'
import { PriceChart } from '@/components/market/price-chart'
import { CompanyInfo } from '@/components/market/company-info'
import { EventsTimeline } from '@/components/market/events-timeline'
import { SkeletonCard } from '@/components/shared/skeleton-card'
import { ErrorBoundary } from '@/components/shared/error-boundary'
import { FormattedAmount } from '@/components/shared/formatted-amount'
import { useFundamentals } from '@/lib/hooks/use-fundamentals'
import { useEvents } from '@/lib/hooks/use-events'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Plus, Eye, AlertCircle, ArrowUp, ArrowDown, TrendingUp, Briefcase } from 'lucide-react'
import { toast } from 'sonner'
import { useSWRConfig } from 'swr'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { formatPercent } from '@/lib/utils/numbers'

// ─── Helper: format large numbers ───────────────────────────────────
function formatLargeNumber(n: number | null): string {
  if (n == null) return '--'
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  return `$${n.toLocaleString()}`
}

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
  const [hoverPrice, setHoverPrice] = useState<number | null>(null)

  // ─── Find user positions for this symbol across all portfolios ────
  const userPositions = useMemo(() => {
    if (!portfolios) return []
    const positions: Array<{
      portfolioId: string
      portfolioName: string
      quantity: number
      avgCost: number
      currency: string
    }> = []
    for (const p of portfolios) {
      for (const pos of p.positions || []) {
        if (pos.symbol === decodedSymbol && pos.quantity > 0) {
          positions.push({
            portfolioId: p.id,
            portfolioName: p.name,
            quantity: pos.quantity,
            avgCost: pos.avg_cost,
            currency: pos.currency || 'USD',
          })
        }
      }
    }
    return positions
  }, [portfolios, decodedSymbol])

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

  const isPositive = (quote?.change ?? 0) >= 0
  const displayPrice = hoverPrice ?? quote?.price
  const companyName = fundamentals?.name && fundamentals.name !== decodedSymbol
    ? fundamentals.name
    : null

  return (
    <div className="space-y-6 max-w-3xl mx-auto">

      {/* ═══════════════════════════════════════════════════════════════
          1. HERO SECTION — Symbol, Name, Price, Change
          ═══════════════════════════════════════════════════════════════ */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <h1 className="text-lg font-semibold text-muted-foreground">{decodedSymbol}</h1>
          {companyName && (
            <span className="text-sm text-muted-foreground">· {companyName}</span>
          )}
        </div>

        {quote && (
          <div>
            <div className="flex items-baseline gap-3">
              <FormattedAmount
                value={displayPrice ?? quote.price}
                from={quote.currency}
                className="text-4xl font-bold tracking-tight"
              />
            </div>
            <div className="flex items-center gap-2 mt-1">
              <span className={cn(
                'flex items-center gap-1 text-sm font-medium',
                isPositive ? 'text-gain' : 'text-loss'
              )}>
                {isPositive
                  ? <ArrowUp className="h-3.5 w-3.5" />
                  : <ArrowDown className="h-3.5 w-3.5" />
                }
                <FormattedAmount
                  value={quote.change}
                  from={quote.currency}
                  showSign
                  className="text-sm font-medium"
                />
                <span>({formatPercent(quote.changePct)})</span>
              </span>
              <span className="text-xs text-muted-foreground px-2 py-0.5 rounded-full bg-muted">
                Hoy
              </span>
            </div>
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          2. INTERACTIVE CHART
          ═══════════════════════════════════════════════════════════════ */}
      <ErrorBoundary>
        <PriceChart symbol={decodedSymbol} onPriceHover={setHoverPrice} />
      </ErrorBoundary>

      {/* ═══════════════════════════════════════════════════════════════
          3. POSITION CARD — Only if user owns this stock
          ═══════════════════════════════════════════════════════════════ */}
      {userPositions.length > 0 && quote && (
        <Card className="rounded-2xl border-border shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Briefcase className="h-4 w-4" />
              Tu posicion
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {userPositions.map((pos) => {
              const marketValue = pos.quantity * quote.price
              const costBasis = pos.quantity * pos.avgCost
              const totalReturn = marketValue - costBasis
              const totalReturnPct = costBasis > 0 ? (totalReturn / costBasis) * 100 : 0
              const todayReturn = pos.quantity * (quote.change ?? 0)
              const isReturnPositive = totalReturn >= 0
              const isTodayPositive = todayReturn >= 0

              return (
                <div key={pos.portfolioId} className="space-y-3">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{pos.portfolioName}</span>
                    <button
                      onClick={() => router.push(`/portfolio/${pos.portfolioId}`)}
                      className="text-primary hover:underline text-xs"
                    >
                      Ver portafolio
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-xs text-muted-foreground">Acciones</p>
                      <p className="text-sm font-semibold font-mono">{pos.quantity}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Valor de mercado</p>
                      <FormattedAmount value={marketValue} from={quote.currency} className="text-sm font-semibold" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Costo promedio</p>
                      <FormattedAmount value={pos.avgCost} from={pos.currency} className="text-sm font-semibold" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Retorno total</p>
                      <div className="flex items-center gap-1">
                        <FormattedAmount value={totalReturn} from={quote.currency} showSign colorize className="text-sm font-semibold" />
                        <span className={cn('text-xs', isReturnPositive ? 'text-gain' : 'text-loss')}>
                          ({formatPercent(totalReturnPct)})
                        </span>
                      </div>
                    </div>
                    <div className="col-span-2">
                      <p className="text-xs text-muted-foreground">Retorno de hoy</p>
                      <div className="flex items-center gap-1">
                        <FormattedAmount value={todayReturn} from={quote.currency} showSign colorize className="text-sm font-semibold" />
                        <span className={cn('text-xs', isTodayPositive ? 'text-gain' : 'text-loss')}>
                          ({formatPercent(quote.changePct)})
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </CardContent>
        </Card>
      )}

      {/* ═══════════════════════════════════════════════════════════════
          4. ACTION BUTTONS
          ═══════════════════════════════════════════════════════════════ */}
      <div className="flex gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger className="inline-flex items-center justify-center rounded-xl text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 h-11 px-4 flex-1 gap-2">
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
          <DropdownMenuTrigger className="inline-flex items-center justify-center rounded-xl text-sm font-medium border border-input bg-background hover:bg-accent hover:text-accent-foreground h-11 px-4 flex-1 gap-2">
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

      {/* ═══════════════════════════════════════════════════════════════
          5. ABOUT SECTION — Company description
          ═══════════════════════════════════════════════════════════════ */}
      {fundamentals && fundamentals.description && (
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
      )}

      {/* ═══════════════════════════════════════════════════════════════
          6. STATS GRID — Fundamentals in 2-column layout
          ═══════════════════════════════════════════════════════════════ */}
      {fundamentals && !fundamentals._partial && (
        <ErrorBoundary>
          <Card className="rounded-2xl border-border shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Estadisticas</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                <StatRow label="Cap. de Mercado" value={formatLargeNumber(fundamentals.market_cap)} />
                <StatRow label="P/E Ratio" value={fundamentals.pe_ratio != null ? `${Number(fundamentals.pe_ratio).toFixed(2)}x` : '--'} />
                <StatRow label="EPS (TTM)" value={fundamentals.eps != null ? `$${Number(fundamentals.eps).toFixed(2)}` : '--'} />
                <StatRow label="Div. Yield" value={fundamentals.dividend_yield != null ? `${Number(fundamentals.dividend_yield).toFixed(2)}%` : '--'} />
                <StatRow label="52 Sem. Alto" value={fundamentals.week52_high != null ? `$${Number(fundamentals.week52_high).toFixed(2)}` : '--'} />
                <StatRow label="52 Sem. Bajo" value={fundamentals.week52_low != null ? `$${Number(fundamentals.week52_low).toFixed(2)}` : '--'} />
              </div>

              {/* 52-week range bar */}
              {fundamentals.week52_high && fundamentals.week52_low && quote?.price && (() => {
                const high = Number(fundamentals.week52_high)
                const low = Number(fundamentals.week52_low)
                const pct = ((quote.price - low) / (high - low)) * 100
                return (
                  <div className="mt-4">
                    <div className="flex justify-between text-xs text-muted-foreground mb-1">
                      <span>${low.toFixed(2)}</span>
                      <span className="text-xs font-medium">Rango 52 semanas</span>
                      <span>${high.toFixed(2)}</span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden relative">
                      <div
                        className="h-full bg-primary rounded-full transition-all"
                        style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
                      />
                    </div>
                  </div>
                )
              })()}
            </CardContent>
          </Card>
        </ErrorBoundary>
      )}

      {/* ═══════════════════════════════════════════════════════════════
          7. ANALYST RATINGS — Buy/Hold/Sell bar
          ═══════════════════════════════════════════════════════════════ */}
      {fundamentals && fundamentals.analyst_rating && (
        <ErrorBoundary>
          <Card className="rounded-2xl border-border shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <TrendingUp className="h-4 w-4" />
                Calificacion de analistas
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-2xl font-bold">{fundamentals.analyst_rating}</p>
                  <p className="text-xs text-muted-foreground">Consenso</p>
                </div>
                {fundamentals.analyst_target_price && (
                  <div className="text-right">
                    <p className="text-2xl font-bold font-mono">${Number(fundamentals.analyst_target_price).toFixed(2)}</p>
                    <p className="text-xs text-muted-foreground">Precio objetivo</p>
                    {quote?.price && (() => {
                      const target = Number(fundamentals.analyst_target_price)
                      const upside = ((target - quote.price) / quote.price) * 100
                      return (
                        <span className={cn(
                          'text-xs font-medium',
                          upside >= 0 ? 'text-gain' : 'text-loss'
                        )}>
                          {upside >= 0 ? '+' : ''}{upside.toFixed(1)}% vs actual
                        </span>
                      )
                    })()}
                  </div>
                )}
              </div>

              {/* Visual rating bar */}
              <AnalystBar rating={fundamentals.analyst_rating} />
            </CardContent>
          </Card>
        </ErrorBoundary>
      )}

      {/* ═══════════════════════════════════════════════════════════════
          8. EVENTS / NEWS
          ═══════════════════════════════════════════════════════════════ */}
      <ErrorBoundary>
        <EventsTimeline events={events ?? []} />
      </ErrorBoundary>
    </div>
  )
}

// ─── Sub-components ─────────────────────────────────────────────────

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-border last:border-b-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold font-mono">{value}</span>
    </div>
  )
}

function AnalystBar({ rating }: { rating: string }) {
  const ratingLower = rating.toLowerCase()

  // Map ratings to visual weights
  let buy = 0, hold = 0, sell = 0
  if (ratingLower.includes('strong buy') || ratingLower === 'compra fuerte') {
    buy = 80; hold = 15; sell = 5
  } else if (ratingLower.includes('buy') || ratingLower === 'compra') {
    buy = 60; hold = 30; sell = 10
  } else if (ratingLower.includes('hold') || ratingLower === 'mantener' || ratingLower === 'neutral') {
    buy = 25; hold = 50; sell = 25
  } else if (ratingLower.includes('sell') || ratingLower === 'venta') {
    buy = 10; hold = 30; sell = 60
  } else {
    buy = 33; hold = 34; sell = 33
  }

  return (
    <div className="space-y-2">
      <div className="flex h-3 rounded-full overflow-hidden">
        <div className="bg-gain transition-all" style={{ width: `${buy}%` }} />
        <div className="bg-amber-400 transition-all" style={{ width: `${hold}%` }} />
        <div className="bg-loss transition-all" style={{ width: `${sell}%` }} />
      </div>
      <div className="flex justify-between text-xs">
        <span className="text-gain font-medium">Comprar {buy}%</span>
        <span className="text-amber-500 font-medium">Mantener {hold}%</span>
        <span className="text-loss font-medium">Vender {sell}%</span>
      </div>
    </div>
  )
}
