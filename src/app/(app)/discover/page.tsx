'use client'

import { useState, useMemo } from 'react'
import { usePublicPortfolios } from '@/lib/hooks/use-discover'
import { useSearchUsers } from '@/lib/hooks/use-social'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Avatar } from '@/components/ui/avatar'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import Link from 'next/link'
import { Heart, TrendingUp, Zap, ChevronRight } from 'lucide-react'
import { FormattedAmount } from '@/components/shared/formatted-amount'
import { PercentageChange } from '@/components/shared/percentage-change'

type Tab = 'popular' | 'returns' | 'diversified' | 'new'
type Sort = 'return' | 'value' | 'likes' | 'recent'

export default function DiscoverPage() {
  const [activeTab, setActiveTab] = useState<Tab>('popular')
  const [sort, setSort] = useState<Sort>('recent')
  const [page, setPage] = useState(1)
  const [searchQuery, setSearchQuery] = useState('')

  const { users: searchResults, isLoading: searchLoading } = useSearchUsers(searchQuery)
  const { portfolios, isLoading, error } = usePublicPortfolios(sort, 'desc', 'all', page)

  const tabToSort: Record<Tab, Sort> = {
    popular: 'likes',
    returns: 'return',
    diversified: 'value',
    new: 'recent',
  }

  const effectiveSort = tabToSort[activeTab]

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

      {/* Search and Sort Row */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex-1 min-w-[200px]">
          <Input
            placeholder="Buscar usuarios..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value)
              setPage(1)
            }}
            className="rounded-xl h-10"
          />
        </div>
        <Select value={sort} onValueChange={(v) => setSort(v as Sort)}>
          <SelectTrigger className="w-[180px] rounded-xl">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="recent">Más Recientes</SelectItem>
            <SelectItem value="return">Mayor Retorno</SelectItem>
            <SelectItem value="value">Mayor Valor</SelectItem>
            <SelectItem value="likes">Más Likes</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Tabs - only shown if no search */}
      {!searchQuery && (
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as Tab)}>
          <TabsList className="grid w-full max-w-md grid-cols-4">
            <TabsTrigger value="popular">Populares</TabsTrigger>
            <TabsTrigger value="returns">Mejores</TabsTrigger>
            <TabsTrigger value="diversified">Diversificados</TabsTrigger>
            <TabsTrigger value="new">Nuevos</TabsTrigger>
          </TabsList>
        </Tabs>
      )}

      {/* Search Results */}
      {searchQuery && searchResults.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {searchResults.map((user) => (
            <Link
              key={user.id}
              href={`/profile/${user.username || user.email}`}
            >
              <Card className="cursor-pointer hover:shadow-md transition-shadow rounded-xl border-border h-full">
                <CardContent className="pt-6">
                  <div className="flex items-start gap-4">
                    <Avatar className="h-12 w-12 rounded-full flex-shrink-0">
                      {user.avatar_url && (
                        <img src={user.avatar_url} alt={user.username} className="h-full w-full object-cover rounded-full" />
                      )}
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold truncate">{user.username || user.email}</p>
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
                          {portfolio.owner.avatar_url && (
                            <img src={portfolio.owner.avatar_url} alt={portfolio.owner.username} className="h-full w-full object-cover rounded-full" />
                          )}
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{portfolio.owner.username || portfolio.owner.email}</p>
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
                          <p className="text-sm font-bold">-</p>
                          <p className="text-xs text-muted-foreground">Sharpe</p>
                        </div>
                        <div>
                          <p className="text-sm font-bold">-</p>
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
                      {portfolio.description && (
                        <div className="flex gap-2 flex-wrap">
                          <Badge variant="secondary" className="text-xs rounded-full">
                            {portfolio.description.slice(0, 20)}
                          </Badge>
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
                <p className="text-muted-foreground">No hay portafolios disponibles</p>
              </CardContent>
            </Card>
          )}

          {/* Pagination */}
          {displayedPortfolios.length > 0 && (
            <div className="flex justify-center pt-4">
              <Button
                onClick={() => setPage((p) => p + 1)}
                variant="outline"
                className="rounded-xl"
              >
                Cargar más
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
