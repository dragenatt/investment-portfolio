'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { usePortfolios } from '@/lib/hooks/use-portfolios'
import { useQuote } from '@/lib/hooks/use-market'
import { useSWRConfig } from 'swr'
import { toast } from 'sonner'
import { FormattedAmount } from '@/components/shared/formatted-amount'
import { useTrade } from '@/lib/contexts/trade-context'
import { SymbolAutocomplete } from '@/components/trade/symbol-autocomplete'
import { Loader2, ArrowRightLeft, TrendingUp, TrendingDown } from 'lucide-react'
import Link from 'next/link'
import { useTranslation } from '@/lib/i18n'

/** Auto-detect asset type from search result type field */
function detectAssetType(typeStr?: string): string {
  if (!typeStr) return 'stock'
  const t = typeStr.toLowerCase()
  if (t.includes('etf')) return 'etf'
  if (t.includes('crypto')) return 'crypto'
  if (t.includes('equity') || t.includes('stock')) return 'stock'
  return 'stock'
}

/** Hook to detect mobile viewport (< 640px) */
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    function check() {
      setIsMobile(window.innerWidth < 640)
    }
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])
  return isMobile
}

interface SelectedSymbol {
  symbol: string
  name: string
  type?: string
  exchDisp?: string
}

function TradeForm({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const { initialOptions } = useTrade()
  const { data: portfolios } = usePortfolios()
  const { mutate } = useSWRConfig()

  // Form state
  const [selectedSymbol, setSelectedSymbol] = useState<SelectedSymbol | null>(null)
  const [symbolInput, setSymbolInput] = useState('')
  const [portfolioId, setPortfolioId] = useState('')
  const [type, setType] = useState<'buy' | 'sell' | 'dividend'>('buy')
  const [assetType, setAssetType] = useState('stock')
  const [price, setPrice] = useState('')
  const [quantity, setQuantity] = useState('')
  const [amount, setAmount] = useState('')
  const [fees, setFees] = useState('0')
  const [currency, setCurrency] = useState('USD')
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0])
  const [loading, setLoading] = useState(false)

  const lastEdited = useRef<'amount' | 'quantity'>('amount')

  // Fetch quote for the selected symbol
  const { data: quote, isLoading: quoteLoading } = useQuote(selectedSymbol?.symbol ?? null)

  // Apply initial options
  useEffect(() => {
    if (initialOptions?.symbol) {
      setSelectedSymbol({ symbol: initialOptions.symbol, name: '' })
      setSymbolInput(initialOptions.symbol)
    }
    if (initialOptions?.portfolioId) {
      setPortfolioId(initialOptions.portfolioId)
    }
    if (initialOptions?.type) {
      setType(initialOptions.type)
    }
  }, [initialOptions])

  // Auto-select first portfolio if none selected and portfolios are loaded
  useEffect(() => {
    if (!portfolioId && portfolios && Array.isArray(portfolios) && portfolios.length > 0) {
      setPortfolioId(portfolios[0].id)
    }
  }, [portfolios, portfolioId])

  // Auto-fill price when quote loads
  useEffect(() => {
    if (quote?.price != null && selectedSymbol) {
      const marketPrice = String(quote.price)
      setPrice(marketPrice)
      if (quote.currency) setCurrency(quote.currency)
    }
  }, [quote?.price, quote?.currency, selectedSymbol])

  // -- Linked field calculations (copied from transaction-modal.tsx lines 56-97) --

  function handleAmountChange(val: string) {
    setAmount(val)
    lastEdited.current = 'amount'
    const amt = parseFloat(val)
    const p = parseFloat(price)
    if (amt > 0 && p > 0) {
      setQuantity((amt / p).toFixed(6))
    } else {
      setQuantity('')
    }
  }

  function handleQuantityChange(val: string) {
    setQuantity(val)
    lastEdited.current = 'quantity'
    const qty = parseFloat(val)
    const p = parseFloat(price)
    if (qty > 0 && p > 0) {
      setAmount((qty * p).toFixed(2))
    } else {
      setAmount('')
    }
  }

  function handlePriceChange(val: string) {
    setPrice(val)
    const p = parseFloat(val)
    if (!p || p <= 0) return

    if (lastEdited.current === 'amount') {
      const amt = parseFloat(amount)
      if (amt > 0) setQuantity((amt / p).toFixed(6))
    } else {
      const qty = parseFloat(quantity)
      if (qty > 0) setAmount((qty * p).toFixed(2))
    }
  }

  // Computed values
  const effectiveQuantity = parseFloat(quantity) || 0
  const effectivePrice = parseFloat(price) || 0
  const effectiveFees = parseFloat(fees) || 0
  const subtotal = effectiveQuantity * effectivePrice
  const totalCost = subtotal + effectiveFees

  const handleSymbolSelect = useCallback((result: { symbol: string; name: string; type?: string; exchDisp?: string }) => {
    setSelectedSymbol(result)
    setSymbolInput(result.symbol)
    setAssetType(detectAssetType(result.type))
  }, [])

  function resetForm() {
    setSelectedSymbol(null)
    setSymbolInput('')
    setPortfolioId('')
    setType('buy')
    setAssetType('stock')
    setPrice('')
    setQuantity('')
    setAmount('')
    setFees('0')
    setCurrency('USD')
    setDate(new Date().toISOString().split('T')[0])
    lastEdited.current = 'amount'
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (!selectedSymbol) {
      toast.error('Selecciona un simbolo')
      return
    }
    if (!portfolioId) {
      toast.error('Selecciona un portafolio')
      return
    }
    if (effectiveQuantity <= 0) {
      toast.error('La cantidad debe ser mayor a 0')
      return
    }
    if (effectivePrice <= 0) {
      toast.error('El precio debe ser mayor a 0')
      return
    }

    setLoading(true)

    try {
      const res = await fetch('/api/transaction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          portfolio_id: portfolioId,
          symbol: selectedSymbol.symbol.toUpperCase(),
          asset_type: assetType,
          type,
          quantity: effectiveQuantity,
          price: effectivePrice,
          fees: effectiveFees,
          currency,
          executed_at: new Date(date + 'T12:00:00').toISOString(),
        }),
      })

      const data = await res.json()

      if (data.error) {
        toast.error(data.error)
        setLoading(false)
        return
      }

      toast.success(t.trade.transaction_recorded)
      mutate(`/api/portfolio/${portfolioId}`)
      mutate('/api/portfolio')
      resetForm()
      onClose()
    } catch {
      toast.error(t.common.error_occurred)
    } finally {
      setLoading(false)
    }
  }

  const typeLabels: Record<string, string> = {
    buy: t.trade.you_will_buy,
    sell: t.trade.you_will_sell,
    dividend: t.trade.you_will_receive,
  }

  const portfolioList = Array.isArray(portfolios) ? portfolios : []
  const hasPortfolios = portfolioList.length > 0

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* 1. Symbol Autocomplete */}
      <div className="space-y-2">
        <Label>{t.trade.symbol}</Label>
        <SymbolAutocomplete
          value={symbolInput}
          onSelect={handleSymbolSelect}
          placeholder="Buscar por nombre o simbolo..."
          autoFocus
        />
      </div>

      {/* 2. Asset card (after symbol selected) */}
      {selectedSymbol && (
        <div className="rounded-lg border p-3 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-mono font-semibold">{selectedSymbol.symbol}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium">
                {assetType.toUpperCase()}
              </span>
            </div>
            {selectedSymbol.name && (
              <p className="text-sm text-muted-foreground truncate">{selectedSymbol.name}</p>
            )}
          </div>
          {quoteLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : quote?.price != null ? (
            <div className="text-right shrink-0">
              <div className="font-mono font-semibold">${quote.price.toFixed(2)}</div>
              {quote.changePct != null && (
                <span
                  className={`text-xs flex items-center justify-end gap-0.5 font-medium ${
                    quote.changePct >= 0 ? 'text-emerald-500' : 'text-red-500'
                  }`}
                >
                  {quote.changePct >= 0 ? (
                    <TrendingUp className="h-3 w-3" />
                  ) : (
                    <TrendingDown className="h-3 w-3" />
                  )}
                  {quote.changePct >= 0 ? '+' : ''}
                  {quote.changePct.toFixed(2)}%
                </span>
              )}
            </div>
          ) : null}
        </div>
      )}

      {/* 3. Portfolio selector */}
      {!hasPortfolios ? (
        <div className="rounded-lg border border-dashed p-4 text-center space-y-2">
          <p className="text-sm text-muted-foreground">No tienes portafolios</p>
          <Link href="/portfolio/new">
            <Button type="button" variant="outline" size="sm">
              Crear portafolio
            </Button>
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          <Label>Portafolio</Label>
          <Select value={portfolioId} onValueChange={v => v && setPortfolioId(v)}>
            <SelectTrigger>
              <SelectValue placeholder="Seleccionar portafolio" />
            </SelectTrigger>
            <SelectContent>
              {portfolioList.map((p: { id: string; name: string }) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* 4. Type pills: Compra / Venta / Dividendo */}
      <div className="space-y-2">
        <Label>{t.trade.type}</Label>
        <div className="flex gap-2">
          {([
            { value: 'buy', label: t.trade.buy },
            { value: 'sell', label: t.trade.sell },
            { value: 'dividend', label: t.trade.dividend },
          ] as const).map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setType(opt.value)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                type === opt.value
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* 5. Price per unit */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>{t.trade.price_per_unit}</Label>
          {selectedSymbol && quote?.price != null && (
            <span className="text-xs text-muted-foreground">
              Mercado:{' '}
              <span className="font-mono font-medium text-foreground">
                ${quote.price.toFixed(2)}
              </span>{' '}
              {quote.currency || currency}
            </span>
          )}
        </div>
        <Input
          type="number"
          step="any"
          value={price}
          onChange={e => handlePriceChange(e.target.value)}
          placeholder="Precio por accion/unidad"
          required
          min="0.01"
        />
      </div>

      {/* 6. Amount <-> Quantity (bidirectional linked fields) */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
          <span>{t.trade.auto_calculate}</span>
        </div>
        <div className="grid grid-cols-[1fr,auto,1fr] gap-2 items-end">
          <div className="space-y-1.5">
            <Label className="text-xs">{t.trade.amount_label} ({currency})</Label>
            <Input
              type="number"
              step="any"
              value={amount}
              onChange={e => handleAmountChange(e.target.value)}
              placeholder="5.00"
              min="0.01"
            />
          </div>
          <div className="pb-2">
            <ArrowRightLeft className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">{t.trade.quantity_label}</Label>
            <Input
              type="number"
              step="any"
              value={quantity}
              onChange={e => handleQuantityChange(e.target.value)}
              placeholder="0.013440"
              min="0.000001"
            />
          </div>
        </div>
      </div>

      {/* 7. Fees + Currency row */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>{t.trade.commission}</Label>
          <Input
            type="number"
            step="any"
            value={fees}
            onChange={e => setFees(e.target.value)}
            min="0"
          />
        </div>
        <div className="space-y-2">
          <Label>{t.trade.currency}</Label>
          <Select value={currency} onValueChange={v => v && setCurrency(v)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="MXN">MXN</SelectItem>
              <SelectItem value="USD">USD</SelectItem>
              <SelectItem value="EUR">EUR</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* 8. Date picker */}
      <div className="space-y-2">
        <Label>Fecha</Label>
        <input
          type="date"
          value={date}
          onChange={e => setDate(e.target.value)}
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        />
      </div>

      {/* 9. Preview */}
      <div className="rounded-lg bg-muted/50 p-3 space-y-1">
        {effectiveQuantity > 0 && effectivePrice > 0 && selectedSymbol && (
          <p className="text-sm">
            {typeLabels[type] || 'Registraras'}{' '}
            <span className="font-mono font-semibold">{effectiveQuantity.toFixed(6)}</span>{' '}
            de <span className="font-semibold">{selectedSymbol.symbol.toUpperCase()}</span>{' '}
            a <FormattedAmount value={effectivePrice} from={currency} className="text-sm font-semibold" />
            /unidad ={' '}
            <FormattedAmount value={subtotal} from={currency} className="text-sm font-semibold" />{' '}
            {currency}
          </p>
        )}
        {effectiveFees > 0 && effectiveQuantity > 0 && (
          <p className="text-xs text-muted-foreground">
            +{' '}
            <FormattedAmount value={effectiveFees} from={currency} className="text-xs" />{' '}
            comision = Total:{' '}
            <FormattedAmount value={totalCost} from={currency} className="text-xs font-semibold" />
          </p>
        )}
      </div>

      {/* 10. Submit button */}
      <Button
        type="submit"
        className="w-full"
        disabled={loading || !selectedSymbol || !portfolioId || effectiveQuantity <= 0 || effectivePrice <= 0}
      >
        {loading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin mr-1" /> {t.trade.saving}
          </>
        ) : (
          t.trade.register_button
        )}
      </Button>
    </form>
  )
}

export function UniversalTradeModal() {
  const { t } = useTranslation()
  const { isOpen, closeTrade } = useTrade()
  const isMobile = useIsMobile()

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) closeTrade()
    },
    [closeTrade]
  )

  if (isMobile) {
    return (
      <Sheet open={isOpen} onOpenChange={handleOpenChange}>
        <SheetContent side="bottom" className="max-h-[90vh] overflow-y-auto rounded-t-2xl">
          <SheetHeader>
            <SheetTitle>{t.trade.new_transaction}</SheetTitle>
          </SheetHeader>
          <div className="px-4 pb-4">
            {isOpen && <TradeForm onClose={closeTrade} />}
          </div>
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t.trade.new_transaction}</DialogTitle>
        </DialogHeader>
        {isOpen && <TradeForm onClose={closeTrade} />}
      </DialogContent>
    </Dialog>
  )
}
