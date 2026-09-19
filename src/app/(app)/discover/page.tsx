'use client'

import { useState, useMemo } from 'react'
import { usePublicPortfolios } from '@/lib/hooks/use-discover'
import { useSearchUsers } from '@/lib/hooks/use-social'
import { useWinnersLosers } from '@/lib/hooks/use-analytics'
import { WinnersLosers } from '@/components/discover/winners-losers'
import { ErrorBoundary } from '@/components/shared/error-boundary'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Avatar } from '@/components/ui/avatar'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import Link from 'next/link'
import { Heart, ChevronRight } from 'lucide-react'
import { PercentageChange } from '@/components/shared/percentage-change'
import type { DiscoverSort } from '@/lib/services/discover'

type Sort = DiscoverSort

const SORT_LABELS: Record<Sort, string> = {
  recent: 'Más Recientes',
  return: 'Mayor Retorno',
  likes: 'Más Likes',
}

/** One page of results, as the route returns it by default. */
const PAGE_SIZE = 20

export default function DiscoverPage() {
  // The tabs and the select are two controls for the same ordering. The tabs
  // used to change nothing, and "Mayor Valor" and "Diversificados" asked for
  // orderings the data cannot give: amounts of public portfolios may be hidden.
  const [sort, setSort] = useState<Sort>('recent')
  const [page, setPage] = useState(1)
  const [searchQuery, setSearchQuery] = useState('')

  const { users: searchResults } = useSearchUsers(searchQuery)
  const { portfolios, isLoading, error } = usePublicPortfolios(sort, 'desc', 'all', page)
  const { data: winnersLosers, isLoading: wlLoading } = useWinnersLosers()

  const changeSort = (next: Sort) => {
    setSort(next)
    setPage(1)
  }

  const displayedPortfolios = useMemo(() => {
    if (searchQuery && searchResults.length > 0) {
      return []
    }
    return portfolios
  }, [portfolios, searchQuery, searchResults])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-2">
        <h1 className="text-3xl font-bold font-serif">Descubrir Portafolios</h1>
        <p className="text-muted-foreground">
          Explora portafolios públicos de otros inversores y aprende de sus estrategias
        </p>
      </div>

      {/* Winners & Losers */}
      <ErrorBoundary>
        <WinnersLosers
          winners={winnersLosers?.winners ?? []}
          losers={winnersLosers?.losers ?? []}
          isLoading={wlLoading}
        />
      </ErrorBoundary>

      {/* Search and Sort Row */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex-1 min-w-[200px]">
          <Input
            placeholder="Buscar usuarios..."
            aria-label="Buscar usuarios"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value)
              setPage(1)
            }}
            className="rounded-xl h-10"
          />
        </div>
        <Select value={sort} onValueChange={(v) => changeSort(v as Sort)}>
          <SelectTrigger className="w-[180px] rounded-xl" aria-label="Ordenar portafolios">
            {/* The label, not the raw value ("recent") the trigger showed. */}
            <SelectValue>{(value: Sort) => SORT_LABELS[value]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(SORT_LABELS) as Sort[]).map((key) => (
              <SelectItem key={key} value={key}>{SORT_LABELS[key]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Tabs - only shown if no search */}
      {!searchQuery && (
        <Tabs value={sort} onValueChange={(v) => changeSort(v as Sort)}>
          <TabsList className="grid w-full max-w-md grid-cols-3">
            <TabsTrigger value="likes">Populares</TabsTrigger>
            <TabsTrigger value="return">Mejores</TabsTrigger>
            <TabsTrigger value="recent">Nuevos</TabsTrigger>
          </TabsList>
        </Tabs>
      )}

      {/* Search Results */}
      {searchQuery && searchResults.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {searchResults.map((user) => (
            <Link
              key={user.id}
              href={`/profile/${encodeURIComponent(user.username)}`}
            >
              <Card className="cursor-pointer hover:shadow-md transition-shadow rounded-xl border-border h-full">
                <CardContent className="pt-6">
                  <div className="flex items-start gap-4">
                    <Avatar className="h-12 w-12 rounded-full flex-shrink-0">
                      {user.avatarUrl && (
                        // eslint-disable-next-line @next/next/no-img-element -- an avatar can be on any host; next/image needs each one allow-listed, and these are 32-64px thumbnails
                        <img src={user.avatarUrl} alt="" className="h-full w-full object-cover rounded-full" />
                      )}
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold truncate">{user.displayName || user.username}</p>
                      <p className="text-sm text-muted-foreground">{user.followerCount} Seguidores</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      {/* Portfolio Grid */}
      {!searchQuery && (
        <>
          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <Card key={i} className="rounded-xl border-border">
                  <CardContent className="pt-6 space-y-4">
                    <Skeleton className="h-10 w-10 rounded-full" />
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-4 w-1/2" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : displayedPortfolios.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {displayedPortfolios.map((portfolio) => (
                <Link
                  key={portfolio.id}
                  href={`/portfolio/${portfolio.id}/public`}
                >
                  <Card className="cursor-pointer hover:shadow-lg transition-all rounded-xl border-border h-full group">
                    <CardContent className="pt-6 space-y-4">
                      {/* Owner Info */}
                      <div className="flex items-center gap-3">
                        <Avatar className="h-10 w-10 rounded-full flex-shrink-0">
                          {portfolio.owner.avatarUrl && (
                            // eslint-disable-next-line @next/next/no-img-element -- an avatar can be on any host; next/image needs each one allow-listed, and these are 32-64px thumbnails
                            <img src={portfolio.owner.avatarUrl} alt="" className="h-full w-full object-cover rounded-full" />
                          )}
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{portfolio.owner.displayName || portfolio.owner.username || 'Inversor'}</p>
                          <p className="text-xs text-muted-foreground truncate">{portfolio.name}</p>
                        </div>
                      </div>

                      {/* Metrics Row */}
                      <div className="grid grid-cols-3 gap-2 text-center py-2 border-t border-b border-border">
                        <div>
                          <PercentageChange value={portfolio.returnPercent} className="text-sm font-bold" />
                          <p className="text-xs text-muted-foreground">Retorno</p>
                        </div>
                        <div>
                          <p className="text-sm font-bold font-financial">
                            {portfolio.sharpeRatio === null ? '—' : portfolio.sharpeRatio.toFixed(2)}
                          </p>
                          <p className="text-xs text-muted-foreground">Sharpe</p>
                        </div>
                        <div>
                          <p className="text-sm font-bold font-financial">{portfolio.positionCount ?? '—'}</p>
                          <p className="text-xs text-muted-foreground">Posiciones</p>
                        </div>
                      </div>

                      {/* Like and Details */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-sm">
                          <Heart className="h-4 w-4 text-red-500" />
                          <span className="text-muted-foreground">{portfolio.likeCount}</span>
                        </div>
                        <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:translate-x-0.5 transition-transform" />
                      </div>

                      {/* Tags */}
                      {portfolio.tags.length > 0 && (
                        <div className="flex gap-2 flex-wrap">
                          {portfolio.tags.slice(0, 3).map((tag) => (
                            <Badge key={tag} variant="secondary" className="text-xs rounded-full">
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          ) : (
            <Card className="rounded-xl border-border">
              <CardContent className="py-12 text-center">
                <p className="text-muted-foreground">
                  {error
                    ? 'No se pudieron cargar los portafolios públicos.'
                    : page > 1
                      ? 'No hay más portafolios públicos.'
                      : 'Todavía no hay portafolios públicos.'}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Pagination: each page replaces the last, so it is a pager, not "load more". */}
          {(page > 1 || displayedPortfolios.length >= PAGE_SIZE) && (
            <div className="flex justify-center gap-2 pt-4">
              <Button onClick={() => setPage((p) => Math.max(1, p - 1))} variant="outline" className="rounded-xl" disabled={page === 1}>
                Anterior
              </Button>
              <Button
                onClick={() => setPage((p) => p + 1)}
                variant="outline"
                className="rounded-xl"
                disabled={displayedPortfolios.length < PAGE_SIZE}
              >
                Siguiente
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
