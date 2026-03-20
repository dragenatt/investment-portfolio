'use client'

import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { useMarketSearch } from '@/lib/hooks/use-market'
import { Badge } from '@/components/ui/badge'
import { Search } from 'lucide-react'
import Link from 'next/link'

export default function MarketPage() {
  const [query, setQuery] = useState('')
  const { data: results, isLoading } = useMarketSearch(query)

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Mercado</h1>

      <div className="relative max-w-lg">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Buscar acciones, ETFs, crypto..."
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
      </div>

      {results && results.length > 0 && (
        <div className="space-y-2">
          {results.map((r: { symbol: string; name: string; type: string; exchDisp: string }) => (
            <Link key={r.symbol} href={`/market/${encodeURIComponent(r.symbol)}`}>
              <div className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted transition-colors">
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

      {query && results?.length === 0 && !isLoading && (
        <p className="text-muted-foreground text-center py-8">No se encontraron resultados para &quot;{query}&quot;</p>
      )}
    </div>
  )
}
