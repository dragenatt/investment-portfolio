'use client'

import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useMarketSearch, useQuote } from '@/lib/hooks/use-market'
import { useWatchlists } from '@/lib/hooks/use-watchlist'
import { useDebounce } from '@/lib/hooks/use-debounce'
import { Badge } from '@/components/ui/badge'
import { Plus, Check, Clock, Loader2, TrendingUp, TrendingDown } from 'lucide-react'
import { useSWRConfig } from 'swr'
import { toast } from 'sonner'

const RECENT_KEY = 'symbol_search_recent'

function getRecentSearches(): string[] {
  try {
    const stored = localStorage.getItem(RECENT_KEY)
    return stored ? JSON.parse(stored) : []
  } catch { return [] }
}

function saveRecentSearch(symbol: string) {
  try {
    const current = getRecentSearches()
    const updated = [symbol, ...current.filter(s => s !== symbol)].slice(0, 5)
    localStorage.setItem(RECENT_KEY, JSON.stringify(updated))
  } catch { /* ignore */ }
}

// Inline quote display for search results
function InlineQuote({ symbol }: { symbol: string }) {
  const { data: quote, isLoading } = useQuote(symbol)
  if (isLoading) return <Loader2 className="h-3 w-3 animate-spin text-muted-foreground ml-auto" />
  if (!quote || quote.price == null) return null
  const pct = quote.changePct
  const isPositive = (pct ?? 0) >= 0
  return (
    <div className="flex items-center gap-2 ml-auto">
      <span className="font-mono text-xs">${quote.price.toFixed(2)}</span>
      {pct != null && (
        <span className={`text-[10px] flex items-center gap-0.5 font-medium ${isPositive ? 'text-gain' : 'text-loss'}`}>
          {isPositive ? <TrendingUp className="h-2.5 w-2.5" /> : <TrendingDown className="h-2.5 w-2.5" />}
          {isPositive ? '+' : ''}{pct.toFixed(2)}%
        </span>
      )}
    </div>
  )
}

export function SymbolSearch() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebounce(query, 300)
  const { data: results } = useMarketSearch(debouncedQuery)
  const { data: watchlists } = useWatchlists()
  const { mutate } = useSWRConfig()
  const router = useRouter()
  const [recentSearches, setRecentSearches] = useState<string[]>([])
  const [addingSymbol, setAddingSymbol] = useState<string | null>(null)

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen(prev => !prev)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Load recent searches when dialog opens
  useEffect(() => {
    if (open) setRecentSearches(getRecentSearches())
  }, [open])

  function handleSelect(symbol: string) {
    saveRecentSearch(symbol)
    setOpen(false)
    setQuery('')
    router.push(`/market/${encodeURIComponent(symbol)}`)
  }

  // Get the first watchlist for quick-add (or null if none)
  const defaultWatchlist = (watchlists as Array<{ id: string; name: string }> | undefined)?.[0]

  const handleAddToWatchlist = useCallback(async (e: React.MouseEvent, symbol: string) => {
    e.stopPropagation()
    e.preventDefault()
    if (!defaultWatchlist) {
      toast.error('Crea una watchlist primero')
      return
    }
    setAddingSymbol(symbol)
    try {
      const res = await fetch(`/api/watchlist/${defaultWatchlist.id}/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol, asset_type: 'stock' }),
      })
      const data = await res.json()
      if (data.error) toast.error(data.error)
      else { toast.success(`${symbol} agregado a "${defaultWatchlist.name}"`); mutate('/api/watchlist') }
    } catch {
      toast.error('Error de conexion')
    }
    setAddingSymbol(null)
  }, [defaultWatchlist, mutate])

  // Symbols already in default watchlist
  const watchlistSymbols = new Set(
    (watchlists as Array<{ watchlist_items?: Array<{ symbol: string }> }> | undefined)
      ?.flatMap(wl => wl.watchlist_items?.map(i => i.symbol) || []) || []
  )

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Buscar acciones, ETFs, crypto..." value={query} onValueChange={setQuery} />
      <CommandList>
        <CommandEmpty>No se encontraron resultados.</CommandEmpty>

        {/* Recent searches when query is empty */}
        {!query && recentSearches.length > 0 && (
          <CommandGroup heading="Busquedas recientes">
            {recentSearches.map(sym => (
              <CommandItem key={sym} value={sym} onSelect={() => handleSelect(sym)}>
                <Clock className="h-3.5 w-3.5 mr-2 text-muted-foreground" />
                <span className="font-mono font-medium">{sym}</span>
                <InlineQuote symbol={sym} />
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {/* Search results with price + change + watchlist add */}
        {results && results.length > 0 && (
          <CommandGroup heading="Resultados">
            {results.map((r: { symbol: string; name: string; type?: string; exchDisp?: string }) => (
              <CommandItem key={r.symbol} value={r.symbol} onSelect={() => handleSelect(r.symbol)} className="flex items-center">
                <div className="flex-1 min-w-0 flex items-center gap-2">
                  <span className="font-mono font-semibold">{r.symbol}</span>
                  <span className="text-muted-foreground truncate text-sm">{r.name}</span>
                </div>
                <InlineQuote symbol={r.symbol} />
                <Badge variant="outline" className="ml-2 text-[10px] shrink-0">{r.exchDisp}</Badge>
                {/* Quick add to watchlist button */}
                {defaultWatchlist && (
                  <button
                    className="ml-2 shrink-0 h-6 w-6 flex items-center justify-center rounded-full border border-border hover:bg-primary hover:text-primary-foreground transition-colors"
                    onClick={(e) => handleAddToWatchlist(e, r.symbol)}
                    title={`Agregar a "${defaultWatchlist.name}"`}
                  >
                    {addingSymbol === r.symbol ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : watchlistSymbols.has(r.symbol) ? (
                      <Check className="h-3 w-3 text-gain" />
                    ) : (
                      <Plus className="h-3 w-3" />
                    )}
                  </button>
                )}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  )
}
