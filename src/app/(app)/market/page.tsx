'use client'

import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { useMarketSearch, useQuote } from '@/lib/hooks/use-market'
import { Badge } from '@/components/ui/badge'
import { Search, TrendingUp, TrendingDown, Loader2 } from 'lucide-react'
import Link from 'next/link'

const POPULAR_SYMBOLS = [
  { symbol: 'AAPL', name: 'Apple Inc.' },
  { symbol: 'MSFT', name: 'Microsoft Corp.' },
  { symbol: 'GOOGL', name: 'Alphabet Inc.' },
  { symbol: 'AMZN', name: 'Amazon.com Inc.' },
  { symbol: 'TSLA', name: 'Tesla Inc.' },
  { symbol: 'NVDA', name: 'NVIDIA Corp.' },
  { symbol: 'META', name: 'Meta Platforms Inc.' },
  { symbol: 'NFLX', name: 'Netflix Inc.' },
]

const INDEX_SYMBOLS = [
  { symbol: '^GSPC', name: 'S&P 500' },
  { symbol: '^MXX', name: 'IPC Mexico' },
  { symbol: '^IXIC', name: 'NASDAQ' },
]

function IndexCard({ symbol, name }: { symbol: string; name: string }) {
  const { data: quote, isLoading, error } = useQuote(symbol)

  return (
    <Link href={`/market/${encodeURIComponent(symbol)}`}>
      <div className="min-w-[200px] p-4 bg-card rounded-2xl border-border border shadow-sm hover:shadow-md transition-shadow">
        <p className="text-sm font-medium text-muted-foreground">{name}</p>
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground mt-1" />
        ) : error ? (
          <span className="text-xs text-muted-foreground">--</span>
        ) : quote ? (
          <>
            <p className="font-mono font-bold text-lg">{quote.price != null ? `$${quote.price.toFixed(2)}` : '--'}</p>
            {quote.changePct != null && (
              <p className={`text-xs flex items-center gap-1 ${quote.changePct >= 0 ? 'text-gain' : 'text-loss'}`}>
                {quote.changePct >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                {quote.changePct >= 0 ? '+' : ''}{quote.changePct.toFixed(2)}%
              </p>
            )}
          </>
        ) : null}
      </div>
    </Link>
  )
}

function QuoteCard({ symbol, name }: { symbol: string; name: string }) {
  const { data: quote, isLoading, error } = useQuote(symbol)

  return (
    <Link href={`/market/${encodeURIComponent(symbol)}`}>
      <div className="p-4 bg-card rounded-2xl border-border border shadow-sm hover:shadow-md transition-shadow">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-xl bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">
              {symbol[0]}
            </div>
            <div>
              <span className="font-mono font-bold">{symbol}</span>
              <p className="text-xs text-muted-foreground truncate max-w-[140px]">{name}</p>
            </div>
          </div>
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : error ? (
            <span className="text-xs text-muted-foreground">--</span>
          ) : quote ? (
            <div className="text-right">
              <p className="font-mono font-medium">{quote.price != null ? `$${quote.price.toFixed(2)}` : '--'}</p>
              {quote.changePct != null && (
                <p className={`text-xs flex items-center gap-1 ${quote.changePct >= 0 ? 'text-gain' : 'text-loss'}`}>
                  {quote.changePct >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                  {quote.changePct >= 0 ? '+' : ''}{quote.changePct.toFixed(2)}%
                </p>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </Link>
  )
}

export default function MarketPage() {
  const [query, setQuery] = useState('')
  const { data: results, isLoading, error } = useMarketSearch(query)

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Mercado</h1>

      <div className="relative max-w-lg">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-9 rounded-xl border-border"
          placeholder="Buscar acciones, ETFs, crypto..."
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
      </div>

      {error && (
        <p className="text-sm text-red-500">Error al buscar: {error.message}</p>
      )}

      {isLoading && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Buscando...</span>
        </div>
      )}

      {results && results.length > 0 && (
        <div className="space-y-2">
          {results.map((r: { symbol: string; name: string; type: string; exchDisp: string }) => (
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

      {query && results?.length === 0 && !isLoading && (
        <p className="text-muted-foreground text-center py-8">No se encontraron resultados para &quot;{query}&quot;</p>
      )}

      {!query && (
        <>
          <h2 className="text-lg font-semibold">Indices</h2>
          <div className="flex overflow-x-auto gap-3 pb-2">
            {INDEX_SYMBOLS.map(s => (
              <IndexCard key={s.symbol} symbol={s.symbol} name={s.name} />
            ))}
          </div>

          <h2 className="text-lg font-semibold">Acciones populares</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {POPULAR_SYMBOLS.map(s => (
              <QuoteCard key={s.symbol} symbol={s.symbol} name={s.name} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
