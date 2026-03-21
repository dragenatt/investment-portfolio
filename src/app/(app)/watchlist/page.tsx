'use client'

import { useWatchlists } from '@/lib/hooks/use-watchlist'
import { useMarketSearch, useQuote } from '@/lib/hooks/use-market'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SkeletonCard } from '@/components/shared/skeleton-card'
import { Plus, X, Search, TrendingUp, TrendingDown, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { useSWRConfig } from 'swr'
import { toast } from 'sonner'
import Link from 'next/link'

function WatchlistItemRow({ watchlistId, item }: { watchlistId: string; item: { id: string; symbol: string; asset_type: string } }) {
  const { data: quote, isLoading } = useQuote(item.symbol)
  const { mutate } = useSWRConfig()

  return (
    <div className="flex items-center justify-between py-2 px-1 hover:bg-muted/50 rounded">
      <Link href={`/market/${encodeURIComponent(item.symbol)}`} className="flex-1">
        <div className="flex items-center justify-between">
          <span className="font-mono font-medium text-sm">{item.symbol}</span>
          {isLoading ? (
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
          ) : quote ? (
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm">${quote.price?.toFixed(2)}</span>
              <span className={`text-xs flex items-center gap-0.5 ${quote.changePct >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {quote.changePct >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                {quote.changePct >= 0 ? '+' : ''}{quote.changePct?.toFixed(2)}%
              </span>
            </div>
          ) : null}
        </div>
      </Link>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 ml-2"
        onClick={async () => {
          await fetch(`/api/watchlist/${watchlistId}/${encodeURIComponent(item.symbol)}`, { method: 'DELETE' })
          mutate('/api/watchlist')
          toast.success('Eliminado de watchlist')
        }}
      >
        <X className="h-3 w-3" />
      </Button>
    </div>
  )
}

export default function WatchlistPage() {
  const { data: watchlists, isLoading } = useWatchlists()
  const { mutate } = useSWRConfig()
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [addingTo, setAddingTo] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const { data: searchResults, isLoading: searching } = useMarketSearch(searchQuery)

  async function handleCreate() {
    if (!newName) return
    setCreating(true)
    const res = await fetch('/api/watchlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName }),
    })
    const data = await res.json()
    if (data.error) toast.error(data.error)
    else { toast.success('Watchlist creada'); mutate('/api/watchlist') }
    setNewName('')
    setCreating(false)
  }

  async function addSymbol(watchlistId: string, symbol: string) {
    const res = await fetch(`/api/watchlist/${watchlistId}/add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol, asset_type: 'stock' }),
    })
    const data = await res.json()
    if (data.error) toast.error(data.error)
    else { toast.success(`${symbol} agregado`); mutate('/api/watchlist') }
    setAddingTo(null)
    setSearchQuery('')
  }

  if (isLoading) return <div className="space-y-4">{[1, 2].map(i => <SkeletonCard key={i} />)}</div>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Watchlists</h1>
        <div className="flex gap-2">
          <Input className="w-48" placeholder="Nueva watchlist..." value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleCreate()} />
          <Button size="sm" onClick={handleCreate} disabled={creating}><Plus className="h-4 w-4" /></Button>
        </div>
      </div>

      {watchlists?.length === 0 && (
        <p className="text-muted-foreground text-center py-8">No tienes watchlists. Crea una para empezar a seguir activos.</p>
      )}

      {watchlists?.map((wl: { id: string; name: string; watchlist_items: Array<{ id: string; symbol: string; asset_type: string }> }) => (
        <Card key={wl.id}>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-lg">{wl.name}</CardTitle>
            <Button variant="outline" size="sm" onClick={() => setAddingTo(addingTo === wl.id ? null : wl.id)}>
              <Plus className="h-3 w-3 mr-1" /> Agregar
            </Button>
          </CardHeader>
          <CardContent>
            {addingTo === wl.id && (
              <div className="mb-4 space-y-2">
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    className="pl-8"
                    placeholder="Buscar accion (ej: AAPL, TSLA)..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    autoFocus
                  />
                </div>
                {searching && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Buscando...</div>}
                {searchResults?.map((r: { symbol: string; name: string }) => (
                  <div key={r.symbol} className="flex items-center justify-between p-2 border rounded hover:bg-muted cursor-pointer" onClick={() => addSymbol(wl.id, r.symbol)}>
                    <div>
                      <span className="font-mono font-medium text-sm">{r.symbol}</span>
                      <span className="text-xs text-muted-foreground ml-2">{r.name}</span>
                    </div>
                    <Plus className="h-4 w-4 text-muted-foreground" />
                  </div>
                ))}
              </div>
            )}

            {wl.watchlist_items?.length === 0 && addingTo !== wl.id ? (
              <p className="text-sm text-muted-foreground">Sin activos. Haz click en &quot;Agregar&quot; para buscar y agregar activos.</p>
            ) : (
              <div className="divide-y">
                {wl.watchlist_items?.map(item => (
                  <WatchlistItemRow key={item.id} watchlistId={wl.id} item={item} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
