'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useMarketSearch, useQuote } from '@/lib/hooks/use-market'
import { useDebounce } from '@/lib/hooks/use-debounce'
import { Input } from '@/components/ui/input'
import { Loader2, TrendingUp, TrendingDown, Clock } from 'lucide-react'

const RECENT_KEY = 'trade_recent_symbols'

interface SearchResult {
  symbol: string
  name: string
  type?: string
  exchDisp?: string
}

export interface SymbolAutocompleteProps {
  value: string
  onSelect: (result: SearchResult) => void
  placeholder?: string
  autoFocus?: boolean
}

function getRecentSearches(): SearchResult[] {
  try {
    const stored = localStorage.getItem(RECENT_KEY)
    return stored ? JSON.parse(stored) : []
  } catch {
    return []
  }
}

function saveRecentSearch(result: SearchResult) {
  try {
    const current = getRecentSearches()
    const updated = [result, ...current.filter(r => r.symbol !== result.symbol)].slice(0, 5)
    localStorage.setItem(RECENT_KEY, JSON.stringify(updated))
  } catch {
    /* ignore */
  }
}

/** Deterministic color from a string hash */
function symbolColor(symbol: string): string {
  const colors = [
    '#6366F1', '#EC4899', '#F59E0B', '#10B981', '#3B82F6',
    '#8B5CF6', '#EF4444', '#14B8A6', '#F97316', '#06B6D4',
  ]
  let hash = 0
  for (let i = 0; i < symbol.length; i++) {
    hash = symbol.charCodeAt(i) + ((hash << 5) - hash)
  }
  return colors[Math.abs(hash) % colors.length]
}

/** Inline quote display for a symbol */
function InlineQuote({ symbol }: { symbol: string }) {
  const { data: quote, isLoading } = useQuote(symbol)
  if (isLoading) return <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
  if (!quote || quote.price == null) return null
  const pct = quote.changePct
  const isPositive = (pct ?? 0) >= 0
  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <span className="font-mono text-xs">${quote.price.toFixed(2)}</span>
      {pct != null && (
        <span
          className={`text-[10px] flex items-center gap-0.5 font-medium ${
            isPositive ? 'text-emerald-500' : 'text-red-500'
          }`}
        >
          {isPositive ? <TrendingUp className="h-2.5 w-2.5" /> : <TrendingDown className="h-2.5 w-2.5" />}
          {isPositive ? '+' : ''}
          {pct.toFixed(2)}%
        </span>
      )}
    </div>
  )
}

export function SymbolAutocomplete({ value, onSelect, placeholder, autoFocus }: SymbolAutocompleteProps) {
  const [query, setQuery] = useState(value)
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const [recentSearches, setRecentSearches] = useState<SearchResult[]>([])

  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const debouncedQuery = useDebounce(query, 300)
  const { data: searchResults, isLoading: searching } = useMarketSearch(debouncedQuery)

  const results: SearchResult[] = searchResults ?? []

  // Sync external value changes
  useEffect(() => {
    setQuery(value)
  }, [value])

  // Load recent searches when dropdown opens with empty query
  useEffect(() => {
    if (isDropdownOpen && query.length < 2) {
      setRecentSearches(getRecentSearches())
    }
  }, [isDropdownOpen, query])

  // Reset highlight when results change
  useEffect(() => {
    setHighlightedIndex(-1)
  }, [searchResults, recentSearches])

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const displayItems: SearchResult[] = query.length >= 2 ? results : recentSearches
  const showDropdown = isDropdownOpen && (displayItems.length > 0 || (query.length >= 2 && !searching))

  const handleSelect = useCallback(
    (result: SearchResult) => {
      saveRecentSearch(result)
      setQuery(result.symbol)
      setIsDropdownOpen(false)
      onSelect(result)
    },
    [onSelect]
  )

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!showDropdown && e.key !== 'ArrowDown') return

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        if (!isDropdownOpen) {
          setIsDropdownOpen(true)
          return
        }
        setHighlightedIndex(prev =>
          prev < displayItems.length - 1 ? prev + 1 : 0
        )
        break
      case 'ArrowUp':
        e.preventDefault()
        setHighlightedIndex(prev =>
          prev > 0 ? prev - 1 : displayItems.length - 1
        )
        break
      case 'Enter':
        e.preventDefault()
        if (highlightedIndex >= 0 && highlightedIndex < displayItems.length) {
          handleSelect(displayItems[highlightedIndex])
        }
        break
      case 'Escape':
        e.preventDefault()
        setIsDropdownOpen(false)
        break
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <Input
        ref={inputRef}
        value={query}
        onChange={e => {
          setQuery(e.target.value)
          setIsDropdownOpen(true)
        }}
        onFocus={() => setIsDropdownOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder ?? 'Buscar por nombre o simbolo...'}
        autoFocus={autoFocus}
        className="h-11 text-base"
      />

      {/* Loading spinner */}
      {searching && query.length >= 2 && (
        <div className="absolute right-3 top-1/2 -translate-y-1/2">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Dropdown */}
      {showDropdown && (
        <div className="absolute z-50 mt-1 w-full border rounded-xl bg-background max-h-64 overflow-y-auto shadow-lg">
          {/* Recent searches header */}
          {query.length < 2 && recentSearches.length > 0 && (
            <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Recientes
            </div>
          )}

          {/* Results / Recents */}
          {displayItems.map((item, index) => (
            <button
              key={item.symbol}
              type="button"
              className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${
                index === highlightedIndex
                  ? 'bg-muted'
                  : 'hover:bg-muted/50'
              }`}
              onMouseEnter={() => setHighlightedIndex(index)}
              onClick={() => handleSelect(item)}
            >
              {/* Logo placeholder: first letter in colored circle */}
              {query.length < 2 ? (
                <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
              ) : (
                <div
                  className="h-7 w-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                  style={{ backgroundColor: symbolColor(item.symbol) }}
                >
                  {item.symbol.charAt(0)}
                </div>
              )}

              {/* Symbol + Name */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono font-semibold text-sm">{item.symbol}</span>
                  {item.exchDisp && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium shrink-0">
                      {item.exchDisp}
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground truncate">{item.name}</p>
              </div>

              {/* Inline price + change */}
              <InlineQuote symbol={item.symbol} />
            </button>
          ))}

          {/* Empty state */}
          {query.length >= 2 && !searching && results.length === 0 && (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              No encontramos resultados para &ldquo;{query}&rdquo;
            </div>
          )}
        </div>
      )}
    </div>
  )
}
