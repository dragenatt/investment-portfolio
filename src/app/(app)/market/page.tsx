'use client'

import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { useMarketSearch } from '@/lib/hooks/use-market'
import { useMarketOverview } from '@/lib/hooks/use-market-overview'
import { useTranslation } from '@/lib/i18n'
import { SectorPerformance } from '@/components/market/sector-performance'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Search, TrendingUp, TrendingDown, Loader2, ArrowUpRight, ArrowDownRight } from 'lucide-react'
import Link from 'next/link'

// ─── Types ──────────────────────────────────────────────────────────────────

type IndexData = {
  symbol: string
  name: string
  region: string
  price: number
  change: number
  changePct: number
}

type MoverData = {
  symbol: string
  name: string
  price: number
  change: number
  changePct: number
}

type SearchResult = {
  symbol: string
  name: string
  type: string
  exchDisp: string
}

// ─── Index Card ─────────────────────────────────────────────────────────────

function IndexCard({ index }: { index: IndexData }) {
  const isPositive = index.changePct >= 0

  return (
    <Link href={`/market/${encodeURIComponent(index.symbol)}`}>
      <Card className="card-hover cursor-pointer h-full">
        <CardContent className="p-4">
          <p className="text-sm font-medium text-muted-foreground mb-1">{index.name}</p>
          <p className="font-mono font-bold text-xl">
            {index.price > 0
              ? index.price.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
              : '--'}
          </p>
          <div className="flex items-center gap-1.5 mt-1">
            <span
              className={`inline-flex items-center gap-0.5 text-xs font-semibold font-mono px-2 py-0.5 rounded-full ${
                isPositive
                  ? 'bg-gain/10 text-gain'
                  : 'bg-loss/10 text-loss'
              }`}
            >
              {isPositive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
              {isPositive ? '+' : ''}{index.changePct.toFixed(2)}%
            </span>
            <span className={`text-xs font-mono ${isPositive ? 'text-gain' : 'text-loss'}`}>
              {isPositive ? '+' : ''}{index.change.toFixed(2)}
            </span>
          </div>
        </CardContent>
      </Card>
    </Link>
  )
}

// ─── Mover Row ──────────────────────────────────────────────────────────────

function MoverRow({ stock, type }: { stock: MoverData; type: 'gainer' | 'loser' }) {
  const isPositive = type === 'gainer'

  return (
    <Link href={`/market/${encodeURIComponent(stock.symbol)}`}>
      <div className="flex items-center justify-between py-3 px-3 rounded-lg hover:bg-muted/50 transition-colors group card-hover">
        <div className="flex items-center gap-3">
          <div
            className={`h-9 w-9 rounded-lg flex items-center justify-center text-xs font-bold ${
              isPositive
                ? 'bg-gain/10 text-gain'
                : 'bg-loss/10 text-loss'
            }`}
          >
            {stock.symbol.slice(0, 2)}
          </div>
          <div>
            <p className="font-mono font-semibold text-sm group-hover:text-foreground">{stock.symbol}</p>
            <p className="text-xs text-muted-foreground truncate max-w-[120px]">{stock.name}</p>
          </div>
        </div>
        <div className="text-right">
          <p className="font-mono text-sm font-medium">
            ${stock.price > 0 ? stock.price.toFixed(2) : '--'}
          </p>
          <div className="flex items-center justify-end gap-0.5">
            {isPositive ? (
              <ArrowUpRight className="h-3 w-3 text-gain" />
            ) : (
              <ArrowDownRight className="h-3 w-3 text-loss" />
            )}
            <span
              className={`text-xs font-mono font-semibold ${
                isPositive ? 'text-gain' : 'text-loss'
              }`}
            >
              {isPositive ? '+' : ''}{stock.changePct.toFixed(2)}%
            </span>
          </div>
        </div>
      </div>
    </Link>
  )
}

// ─── Loading Skeletons ──────────────────────────────────────────────────────

function IndexCardSkeleton() {
  return (
    <Card>
      <CardContent className="p-4 space-y-2">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-7 w-28" />
        <Skeleton className="h-5 w-20" />
      </CardContent>
    </Card>
  )
}

function MoverRowSkeleton() {
  return (
    <div className="flex items-center justify-between py-3 px-3">
      <div className="flex items-center gap-3">
        <Skeleton className="h-9 w-9 rounded-lg" />
        <div className="space-y-1">
          <Skeleton className="h-4 w-14" />
          <Skeleton className="h-3 w-24" />
        </div>
      </div>
      <div className="space-y-1 flex flex-col items-end">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-3 w-12" />
      </div>
    </div>
  )
}

// ─── Main Page ──────────────────────────────────────────────────────────────

export default function MarketPage() {
  const [query, setQuery] = useState('')
  const { t } = useTranslation()
  const { data: results, isLoading: searchLoading, error: searchError } = useMarketSearch(query)
  const { data: overview, isLoading: overviewLoading } = useMarketOverview()

  return (
    <div className="space-y-8">
      {/* ── Title + Search ── */}
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">{t.market.title}</h1>
        <div className="relative max-w-xl">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-11 h-11 text-sm rounded-xl border-border bg-muted/30 focus:bg-background transition-colors"
            placeholder={t.market.search_placeholder}
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
        </div>
      </div>

        {/* ── Search Results ── */}
        {searchError && (
          <p className="text-sm text-red-500">{t.market.search_error}: {searchError.message}</p>
        )}

        {searchLoading && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">{t.market.searching}</span>
          </div>
        )}

        {results && results.length > 0 && (
          <div className="space-y-2">
            {results.map((r: SearchResult) => (
              <Link key={r.symbol} href={`/market/${encodeURIComponent(r.symbol)}`}>
                <div className="flex items-center justify-between p-3 rounded-xl border-border border hover:bg-muted transition-colors">
                  <div>
                    <span className="font-mono font-medium">{r.symbol}</span>
                    <p className="text-sm text-muted-foreground">{r.name}</p>
                  </div>
                  <div className="flex gap-2">
                    <Badge variant="outline">{r.type}</Badge>
                    <Badge variant="secondary">{r.exchDisp}</Badge>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}

        {query && results?.length === 0 && !searchLoading && (
          <p className="text-muted-foreground text-center py-8">
            {t.market.no_results}
          </p>
        )}

        {/* ── Market Content (hidden when searching) ── */}
        {!query && (
          <>
            {/* ── Indices Section ── */}
            <section>
              <h2 className="text-lg font-semibold mb-3">{t.market.indices}</h2>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {overviewLoading
                  ? Array.from({ length: 6 }).map((_, i) => <IndexCardSkeleton key={i} />)
                  : overview?.indices?.map((idx: IndexData) => (
                      <IndexCard key={idx.symbol} index={idx} />
                    ))
                }
              </div>
            </section>

            {/* ── Top Movers: Gainers & Losers ── */}
            <section>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Gainers */}
                <Card>
                  <CardHeader className="pb-1">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <TrendingUp className="h-4 w-4 text-gain" />
                      {t.market.top_gainers}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    {overviewLoading ? (
                      <div className="space-y-1">
                        {Array.from({ length: 5 }).map((_, i) => (
                          <MoverRowSkeleton key={i} />
                        ))}
                      </div>
                    ) : overview?.gainers && overview.gainers.length > 0 ? (
                      <div className="divide-y divide-border/50">
                        {overview.gainers.map((stock: MoverData) => (
                          <MoverRow key={stock.symbol} stock={stock} type="gainer" />
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground py-6 text-center">
                        {t.market.no_data}
                      </p>
                    )}
                  </CardContent>
                </Card>

                {/* Losers */}
                <Card>
                  <CardHeader className="pb-1">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <TrendingDown className="h-4 w-4 text-loss" />
                      {t.market.top_losers}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    {overviewLoading ? (
                      <div className="space-y-1">
                        {Array.from({ length: 5 }).map((_, i) => (
                          <MoverRowSkeleton key={i} />
                        ))}
                      </div>
                    ) : overview?.losers && overview.losers.length > 0 ? (
                      <div className="divide-y divide-border/50">
                        {overview.losers.map((stock: MoverData) => (
                          <MoverRow key={stock.symbol} stock={stock} type="loser" />
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground py-6 text-center">
                        {t.market.no_data}
                      </p>
                    )}
                  </CardContent>
                </Card>
              </div>
            </section>

            {/* ── Sector Performance ── */}
            {overview?.sectors && (
              <section>
                <h2 className="text-lg font-semibold mb-3">{t.market.by_sector}</h2>
                <Card>
                  <CardContent className="p-4">
                    <SectorPerformance sectors={overview.sectors} />
                  </CardContent>
                </Card>
              </section>
            )}
          </>
        )}
    </div>
  )
}
