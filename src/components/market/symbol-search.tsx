'use client'

import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useMarketSearch } from '@/lib/hooks/use-market'
import { useDebounce } from '@/lib/hooks/use-debounce'
import { Badge } from '@/components/ui/badge'

export function SymbolSearch() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebounce(query, 300)
  const { data: results } = useMarketSearch(debouncedQuery)
  const router = useRouter()

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

  function handleSelect(symbol: string) {
    setOpen(false)
    setQuery('')
    router.push(`/market/${encodeURIComponent(symbol)}`)
  }

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Buscar acciones, ETFs, crypto..." value={query} onValueChange={setQuery} />
      <CommandList>
        <CommandEmpty>No se encontraron resultados.</CommandEmpty>
        {results && results.length > 0 && (
          <CommandGroup heading="Resultados">
            {results.map((r: { symbol: string; name: string; type: string; exchDisp: string }) => (
              <CommandItem key={r.symbol} value={r.symbol} onSelect={() => handleSelect(r.symbol)}>
                <span className="font-mono font-medium">{r.symbol}</span>
                <span className="ml-2 text-muted-foreground truncate">{r.name}</span>
                <Badge variant="outline" className="ml-auto text-xs">{r.exchDisp}</Badge>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  )
}
