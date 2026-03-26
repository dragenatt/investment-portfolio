'use client'

import { useWatchlists } from '@/lib/hooks/use-watchlist'
import { useLivePrices } from '@/lib/hooks/use-live-prices'
import { useMarketSearch } from '@/lib/hooks/use-market'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { SkeletonCard } from '@/components/shared/skeleton-card'
import { EmptyState } from '@/components/shared/empty-state'
import { ErrorDisplay } from '@/components/shared/error-display'
import { Plus, Search, TrendingUp, TrendingDown, Loader2, Pencil, Trash2, Eye, ArrowUp, ArrowDown, ArrowUpDown, Check, ShoppingCart } from 'lucide-react'
import { useTrade } from '@/lib/contexts/trade-context'
import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { useDebounce } from '@/lib/hooks/use-debounce'
import { useSWRConfig } from 'swr'
import { toast } from 'sonner'
import Link from 'next/link'

type WatchlistItem = { id: string; symbol: string; asset_type: string }
type Watchlist = { id: string; name: string; watchlist_items: WatchlistItem[] }
type SortKey = 'symbol' | 'price' | 'changePct'
type SortDir = 'asc' | 'desc'
type SortState = { key: SortKey; dir: SortDir }
type PriceData = Record<string, { price: number | null; change: number | null; changePct: number | null; currency: string }>

// --- Mini sparkline SVG (simple inline) ---
function MiniSparkline({ positive }: { positive: boolean }) {
  // Simple decorative sparkline shapes
  const upPath = 'M0,14 L4,12 L8,13 L12,10 L16,11 L20,7 L24,8 L28,4 L32,3'
  const downPath = 'M0,4 L4,5 L8,3 L12,7 L16,6 L20,10 L24,11 L28,13 L32,14'
  return (
    <svg width="32" height="16" viewBox="0 0 32 16" className="inline-block ml-1">
      <path
        d={positive ? upPath : downPath}
        fill="none"
        stroke={positive ? 'var(--color-gain, #22c55e)' : 'var(--color-loss, #ef4444)'}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

// --- Sort icon for table headers ---
function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <ArrowUpDown className="h-3 w-3 ml-1 text-muted-foreground/50" />
  return dir === 'asc'
    ? <ArrowUp className="h-3 w-3 ml-1 text-primary" />
    : <ArrowDown className="h-3 w-3 ml-1 text-primary" />
}

// --- Watchlist table with sortable columns & live prices ---
function WatchlistTable({ watchlist, prices }: { watchlist: Watchlist; prices: PriceData | undefined }) {
  const { mutate } = useSWRConfig()
  const { openTrade } = useTrade()
  const [sort, setSort] = useState<SortState>({ key: 'symbol', dir: 'asc' })
  const [deletingSymbol, setDeletingSymbol] = useState<string | null>(null)

  function toggleSort(key: SortKey) {
    setSort(prev => prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' })
  }

  const sorted = useMemo(() => {
    const items = [...(watchlist.watchlist_items || [])]
    return items.sort((a, b) => {
      const dir = sort.dir === 'asc' ? 1 : -1
      if (sort.key === 'symbol') return a.symbol.localeCompare(b.symbol) * dir
      const pa = prices?.[a.symbol]
      const pb = prices?.[b.symbol]
      if (sort.key === 'price') return ((pa?.price ?? 0) - (pb?.price ?? 0)) * dir
      if (sort.key === 'changePct') return ((pa?.changePct ?? 0) - (pb?.changePct ?? 0)) * dir
      return 0
    })
  }, [watchlist.watchlist_items, sort, prices])

  async function handleDelete(symbol: string) {
    setDeletingSymbol(symbol)
    const res = await fetch(`/api/watchlist/${watchlist.id}/${encodeURIComponent(symbol)}`, { method: 'DELETE' })
    const data = await res.json()
    if (data.error) toast.error('Error al eliminar')
    else { toast.success(`${symbol} eliminado`); mutate('/api/watchlist') }
    setDeletingSymbol(null)
  }

  if (sorted.length === 0) return null

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>
            <button className="flex items-center text-xs font-semibold uppercase tracking-wider cursor-pointer select-none" onClick={() => toggleSort('symbol')}>
              Simbolo
              <SortIcon active={sort.key === 'symbol'} dir={sort.dir} />
            </button>
          </TableHead>
          <TableHead className="text-right">
            <button className="flex items-center justify-end text-xs font-semibold uppercase tracking-wider cursor-pointer select-none w-full" onClick={() => toggleSort('price')}>
              Precio
              <SortIcon active={sort.key === 'price'} dir={sort.dir} />
            </button>
          </TableHead>
          <TableHead className="text-right">
            <button className="flex items-center justify-end text-xs font-semibold uppercase tracking-wider cursor-pointer select-none w-full" onClick={() => toggleSort('changePct')}>
              Cambio %
              <SortIcon active={sort.key === 'changePct'} dir={sort.dir} />
            </button>
          </TableHead>
          <TableHead className="w-20"></TableHead>
          <TableHead className="w-10"></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map(item => {
          const q = prices?.[item.symbol]
          const pct = q?.changePct
          const isPositive = (pct ?? 0) >= 0
          return (
            <TableRow key={item.id} className="group">
              <TableCell>
                <Link href={`/market/${encodeURIComponent(item.symbol)}`} className="flex items-center gap-2 hover:underline">
                  <span className="font-mono font-semibold text-sm">{item.symbol}</span>
                  <MiniSparkline positive={isPositive} />
                </Link>
              </TableCell>
              <TableCell className="text-right font-mono text-sm">
                {q?.price != null ? `$${q.price.toFixed(2)}` : <span className="text-muted-foreground">--</span>}
              </TableCell>
              <TableCell className="text-right">
                {pct != null ? (
                  <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${isPositive ? 'text-gain' : 'text-loss'}`}>
                    {isPositive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                    {isPositive ? '+' : ''}{pct.toFixed(2)}%
                  </span>
                ) : <span className="text-muted-foreground text-xs">--</span>}
              </TableCell>
              <TableCell>
                <button
                  className="bg-primary text-primary-foreground rounded-full px-3 py-1 text-xs font-medium opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => openTrade({ symbol: item.symbol })}
                >
                  Comprar
                </button>
              </TableCell>
              <TableCell>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity text-destructive"
                  disabled={deletingSymbol === item.symbol}
                  onClick={() => handleDelete(item.symbol)}
                >
                  {deletingSymbol === item.symbol ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                </Button>
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

// --- Add symbol panel with one-tap add ---
function AddSymbolPanel({ watchlistId, existingSymbols }: { watchlistId: string; existingSymbols: string[] }) {
  const { mutate } = useSWRConfig()
  const [searchQuery, setSearchQuery] = useState('')
  const debouncedSearch = useDebounce(searchQuery, 300)
  const { data: searchResults, isLoading: searching } = useMarketSearch(debouncedSearch)
  const [addingSymbol, setAddingSymbol] = useState<string | null>(null)
  const [highlightIdx, setHighlightIdx] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)

  // Recent searches from localStorage
  const [recentSearches, setRecentSearches] = useState<string[]>([])
  useEffect(() => {
    try {
      const stored = localStorage.getItem('watchlist_recent_searches')
      if (stored) setRecentSearches(JSON.parse(stored))
    } catch { /* ignore */ }
  }, [])

  function saveRecent(symbol: string) {
    const updated = [symbol, ...recentSearches.filter(s => s !== symbol)].slice(0, 5)
    setRecentSearches(updated)
    try { localStorage.setItem('watchlist_recent_searches', JSON.stringify(updated)) } catch { /* ignore */ }
  }

  async function addSymbol(symbol: string) {
    if (existingSymbols.includes(symbol)) {
      toast.info(`${symbol} ya esta en la watchlist`)
      return
    }
    setAddingSymbol(symbol)
    saveRecent(symbol)
    const res = await fetch(`/api/watchlist/${watchlistId}/add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol, asset_type: 'stock' }),
    })
    const data = await res.json()
    if (data.error) toast.error(data.error)
    else { toast.success(`${symbol} agregado`); mutate('/api/watchlist') }
    setAddingSymbol(null)
  }

  const results = searchResults as Array<{ symbol: string; name: string; type?: string; exchDisp?: string }> | undefined

  // Keyboard nav
  function handleKeyDown(e: React.KeyboardEvent) {
    if (!results || results.length === 0) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlightIdx(i => Math.min(i + 1, results.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlightIdx(i => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter' && highlightIdx >= 0 && highlightIdx < results.length) {
      e.preventDefault()
      addSymbol(results[highlightIdx].symbol)
    }
  }

  // Reset highlight when results change
  useEffect(() => { setHighlightIdx(-1) }, [searchResults])

  const alreadyAdded = new Set(existingSymbols)

  return (
    <div className="mb-4 space-y-1">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          ref={inputRef}
          className="pl-8 rounded-xl border-border"
          placeholder="Buscar accion (ej: AAPL, TSLA)..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          autoFocus
        />
      </div>

      {searching && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-2 px-1">
          <Loader2 className="h-3 w-3 animate-spin" /> Buscando...
        </div>
      )}

      {/* Recent searches when search is empty */}
      {!searchQuery && recentSearches.length > 0 && (
        <div className="py-1">
          <p className="text-xs text-muted-foreground px-2 py-1 font-medium">Busquedas recientes</p>
          {recentSearches.map(sym => (
            <div
              key={sym}
              className="flex items-center justify-between px-2 py-1.5 rounded-lg hover:bg-muted cursor-pointer text-sm"
              onClick={() => setSearchQuery(sym)}
            >
              <span className="font-mono font-medium">{sym}</span>
              <Search className="h-3 w-3 text-muted-foreground" />
            </div>
          ))}
        </div>
      )}

      {/* Search results with inline price info and one-tap add */}
      {results && results.length > 0 && (
        <div className="max-h-64 overflow-y-auto">
          {results.map((r, idx) => {
            const isAdded = alreadyAdded.has(r.symbol)
            const isAdding = addingSymbol === r.symbol
            return (
              <div
                key={r.symbol}
                className={`flex items-center justify-between px-2 py-2 rounded-lg cursor-pointer transition-colors ${
                  idx === highlightIdx ? 'bg-muted' : 'hover:bg-muted/50'
                }`}
                onClick={() => !isAdded && addSymbol(r.symbol)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-semibold text-sm">{r.symbol}</span>
                    {r.exchDisp && (
                      <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{r.exchDisp}</span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{r.name}</p>
                </div>
                <div className="flex-shrink-0 ml-2">
                  {isAdding ? (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  ) : isAdded ? (
                    <Check className="h-4 w-4 text-gain" />
                  ) : (
                    <div className="h-7 w-7 flex items-center justify-center rounded-full border border-border hover:bg-primary hover:text-primary-foreground transition-colors">
                      <Plus className="h-3.5 w-3.5" />
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// --- Main page ---
export default function WatchlistPage() {
  const { data: watchlists, isLoading, error } = useWatchlists()
  const { mutate } = useSWRConfig()
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [addingTo, setAddingTo] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [deletingWl, setDeletingWl] = useState<{ id: string; name: string } | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)

  // Collect all symbols across all watchlists for batch price fetch
  const allSymbols = useMemo(() => {
    if (!watchlists) return []
    return (watchlists as Watchlist[]).flatMap(wl => wl.watchlist_items?.map(i => i.symbol) || [])
  }, [watchlists])

  const { data: prices } = useLivePrices(allSymbols)

  async function handleCreate() {
    if (!newName.trim()) return
    setCreating(true)
    const res = await fetch('/api/watchlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim() }),
    })
    const data = await res.json()
    if (data.error) toast.error(data.error)
    else { toast.success('Watchlist creada'); mutate('/api/watchlist') }
    setNewName('')
    setCreating(false)
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
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Watchlists</h1>
        <div className="flex gap-2">
          <Input
            className="w-48 rounded-xl border-border"
            placeholder="Nueva watchlist..."
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleCreate()}
          />
          <Button className="rounded-xl" size="sm" onClick={handleCreate} disabled={creating}>
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {/* Empty state */}
      {watchlists?.length === 0 && (
        <EmptyState
          icon={Eye}
          title="Sin watchlists"
          description="Crea tu primera watchlist para seguir de cerca los activos que te interesan."
          action={{ label: 'Crear watchlist', onClick: () => document.querySelector<HTMLInputElement>('.w-48')?.focus() }}
        />
      )}

      {/* Watchlist cards */}
      {(watchlists as Watchlist[] | undefined)?.map(wl => (
        <Card key={wl.id} className="rounded-2xl border-border shadow-sm card-hover">
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
                  <span className="text-xs text-muted-foreground">
                    {wl.watchlist_items?.length || 0} {(wl.watchlist_items?.length || 0) === 1 ? 'activo' : 'activos'}
                  </span>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => { setRenamingId(wl.id); setRenameValue(wl.name) }}>
                    <Pencil className="h-3 w-3" />
                  </Button>
                </>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                className="rounded-xl"
                variant={addingTo === wl.id ? 'default' : 'outline'}
                size="sm"
                onClick={() => setAddingTo(addingTo === wl.id ? null : wl.id)}
              >
                {addingTo === wl.id ? (
                  <>Cerrar</>
                ) : (
                  <><Plus className="h-3 w-3 mr-1" /> Agregar</>
                )}
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setDeletingWl({ id: wl.id, name: wl.name })}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {/* One-tap add panel */}
            {addingTo === wl.id && (
              <AddSymbolPanel
                watchlistId={wl.id}
                existingSymbols={wl.watchlist_items?.map(i => i.symbol) || []}
              />
            )}

            {/* Table or empty message */}
            {wl.watchlist_items?.length === 0 && addingTo !== wl.id ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                Sin activos. Haz click en &quot;Agregar&quot; para buscar y agregar activos.
              </p>
            ) : (
              <WatchlistTable watchlist={wl} prices={prices as PriceData | undefined} />
            )}
          </CardContent>
        </Card>
      ))}

      {/* Delete watchlist confirmation dialog */}
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
