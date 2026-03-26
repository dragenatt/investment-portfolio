'use client'

import { useWatchlists } from '@/lib/hooks/use-watchlist'
import { useMarketSearch, useQuote } from '@/lib/hooks/use-market'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { SkeletonCard } from '@/components/shared/skeleton-card'
import { EmptyState } from '@/components/shared/empty-state'
import { ErrorDisplay } from '@/components/shared/error-display'
import { Plus, X, Search, TrendingUp, TrendingDown, Loader2, Pencil, Trash2, Eye } from 'lucide-react'
import { useState } from 'react'
import { useDebounce } from '@/lib/hooks/use-debounce'
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
              <span className="font-mono text-sm">{quote.price != null ? `$${quote.price.toFixed(2)}` : '--'}</span>
              {quote.changePct != null && (
                <span className={`text-xs flex items-center gap-0.5 ${quote.changePct >= 0 ? 'text-gain' : 'text-loss'}`}>
                  {quote.changePct >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                  {quote.changePct >= 0 ? '+' : ''}{quote.changePct.toFixed(2)}%
                </span>
              )}
            </div>
          ) : null}
        </div>
      </Link>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 ml-2"
        onClick={async () => {
          const res = await fetch(`/api/watchlist/${watchlistId}/${encodeURIComponent(item.symbol)}`, { method: 'DELETE' })
          const data = await res.json()
          if (data.error) {
            toast.error('Error al eliminar')
            return
          }
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
  const { data: watchlists, isLoading, error } = useWatchlists()
  const { mutate } = useSWRConfig()
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [addingTo, setAddingTo] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const debouncedSearch = useDebounce(searchQuery, 300)
  const { data: searchResults, isLoading: searching } = useMarketSearch(debouncedSearch)
  const [sortBy, setSortBy] = useState<Record<string, string>>({})
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [deletingWl, setDeletingWl] = useState<{ id: string; name: string } | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)

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

  async function handleRename(watchlistId: string) {
    const trimmed = renameValue.trim()
    if (!trimmed) { setRenamingId(null); return }
    const res = await fetch(`/api/watchlist/${watchlistId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: trimmed }),
    })
    const data = await res.json()
    if (data.error) toast.error(data.error)
    else { toast.success('Nombre actualizado'); mutate('/api/watchlist') }
    setRenamingId(null)
  }

  async function handleDeleteWatchlist() {
    if (!deletingWl) return
    setDeleteLoading(true)
    const res = await fetch(`/api/watchlist/${deletingWl.id}`, { method: 'DELETE' })
    const data = await res.json()
    if (data.error) toast.error(data.error)
    else { toast.success('Watchlist eliminada'); mutate('/api/watchlist') }
    setDeletingWl(null)
    setDeleteLoading(false)
  }

  if (isLoading) return <div className="space-y-4">{[1, 2].map(i => <SkeletonCard key={i} />)}</div>

  if (error) return <ErrorDisplay error="Error al cargar watchlists. Intenta recargar la pagina." onRetry={() => window.location.reload()} />

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Watchlists</h1>
        <div className="flex gap-2">
          <Input className="w-48 rounded-xl border-border" placeholder="Nueva watchlist..." value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleCreate()} />
          <Button className="rounded-xl" size="sm" onClick={handleCreate} disabled={creating}><Plus className="h-4 w-4" /></Button>
        </div>
      </div>

      {watchlists?.length === 0 && (
        <EmptyState
          icon={Eye}
          title="Sin watchlists"
          description="Crea tu primera watchlist para seguir de cerca los activos que te interesan."
          action={{ label: 'Crear watchlist', onClick: () => document.querySelector<HTMLInputElement>('.w-48')?.focus() }}
        />
      )}

      {watchlists?.map((wl: { id: string; name: string; watchlist_items: Array<{ id: string; symbol: string; asset_type: string }> }) => (
        <Card key={wl.id} className="rounded-2xl border-border shadow-sm">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <div className="flex items-center gap-2">
              {renamingId === wl.id ? (
                <Input
                  className="h-8 w-48 rounded-xl border-border"
                  value={renameValue}
                  onChange={e => setRenameValue(e.target.value)}
                  onBlur={() => handleRename(wl.id)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleRename(wl.id)
                    if (e.key === 'Escape') setRenamingId(null)
                  }}
                  autoFocus
                />
              ) : (
                <>
                  <CardTitle className="text-lg">{wl.name}</CardTitle>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => { setRenamingId(wl.id); setRenameValue(wl.name) }}>
                    <Pencil className="h-3 w-3" />
                  </Button>
                </>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Select value={sortBy[wl.id] || 'default'} onValueChange={v => { if (v) setSortBy(s => ({ ...s, [wl.id]: v })) }}>
                <SelectTrigger className="h-8 w-32 text-xs rounded-xl"><SelectValue placeholder="Ordenar" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">Por defecto</SelectItem>
                  <SelectItem value="name">Nombre</SelectItem>
                  <SelectItem value="price" disabled>Precio (pronto)</SelectItem>
                  <SelectItem value="change" disabled>Cambio % (pronto)</SelectItem>
                </SelectContent>
              </Select>
              <Button className="rounded-xl" variant="outline" size="sm" onClick={() => setAddingTo(addingTo === wl.id ? null : wl.id)}>
                <Plus className="h-3 w-3 mr-1" /> Agregar
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500" onClick={() => setDeletingWl({ id: wl.id, name: wl.name })}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {addingTo === wl.id && (
              <div className="mb-4 space-y-2">
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    className="pl-8 rounded-xl border-border"
                    placeholder="Buscar accion (ej: AAPL, TSLA)..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    autoFocus
                  />
                </div>
                {searching && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Buscando...</div>}
                {searchResults?.map((r: { symbol: string; name: string }) => (
                  <div key={r.symbol} className="flex items-center justify-between p-2 rounded-xl border-border border hover:bg-muted cursor-pointer" onClick={() => addSymbol(wl.id, r.symbol)}>
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
                {[...(wl.watchlist_items || [])].sort((a, b) => {
                  const sort = sortBy[wl.id]
                  if (sort === 'name') return a.symbol.localeCompare(b.symbol)
                  return 0
                }).map(item => (
                  <WatchlistItemRow key={item.id} watchlistId={wl.id} item={item} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ))}

      <Dialog open={!!deletingWl} onOpenChange={(open) => { if (!open) setDeletingWl(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Eliminar watchlist</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Eliminar watchlist &quot;{deletingWl?.name}&quot; y todos sus activos? Esta accion no se puede deshacer.
          </p>
          <DialogFooter>
            <Button className="rounded-xl" variant="outline" onClick={() => setDeletingWl(null)}>Cancelar</Button>
            <Button className="rounded-xl" variant="destructive" onClick={handleDeleteWatchlist} disabled={deleteLoading}>
              {deleteLoading ? 'Eliminando...' : 'Eliminar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
