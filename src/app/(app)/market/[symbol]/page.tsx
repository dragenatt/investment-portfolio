'use client'

import { use } from 'react'
import { useQuote } from '@/lib/hooks/use-market'
import { PriceDisplay } from '@/components/market/price-display'
import { PriceChart } from '@/components/market/price-chart'
import { SkeletonCard } from '@/components/shared/skeleton-card'
import { ErrorBoundary } from '@/components/shared/error-boundary'

export default function SymbolDetailPage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = use(params)
  const decodedSymbol = decodeURIComponent(symbol)
  const { data: quote, isLoading } = useQuote(decodedSymbol)

  if (isLoading) return <SkeletonCard />

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold font-mono">{decodedSymbol}</h1>
        {quote && (
          <PriceDisplay
            price={quote.price}
            change={quote.change}
            changePct={quote.changePct}
            currency={quote.currency}
            size="lg"
          />
        )}
      </div>

      <ErrorBoundary>
        <PriceChart symbol={decodedSymbol} />
      </ErrorBoundary>
    </div>
  )
}
