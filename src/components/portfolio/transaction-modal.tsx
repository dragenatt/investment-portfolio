'use client'

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useState, useEffect, useMemo } from 'react'
import { useSWRConfig } from 'swr'
import { toast } from 'sonner'
import { Plus } from 'lucide-react'
import { useMarketSearch, useQuote } from '@/lib/hooks/use-market'
import { FormattedAmount } from '@/components/shared/formatted-amount'
import { cn } from '@/lib/utils'

type InputMode = 'quantity' | 'amount'

type Props = { portfolioId: string }

export function TransactionModal({ portfolioId }: Props) {
  const [open, setOpen] = useState(false)
  const [symbol, setSymbol] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [type, setType] = useState<string>('buy')
  const [assetType, setAssetType] = useState<string>('stock')
  const [quantity, setQuantity] = useState('')
  const [price, setPrice] = useState('')
  const [fees, setFees] = useState('0')
  const [currency, setCurrency] = useState('USD')
  const [loading, setLoading] = useState(false)
  const [inputMode, setInputMode] = useState<InputMode>('quantity')
  const [amount, setAmount] = useState('')
  const { mutate } = useSWRConfig()
  const { data: searchResults } = useMarketSearch(searchQuery)

  // Fetch current market price when a symbol is selected (not while typing)
  const resolvedSymbol = symbol && searchQuery === '' ? symbol : null
  const { data: quote, isLoading: quoteLoading } = useQuote(resolvedSymbol)

  // Auto-fill price field when quote loads
  useEffect(() => {
    if (quote?.price != null && resolvedSymbol) {
      setPrice(String(quote.price))
    }
  }, [quote?.price, resolvedSymbol])

  // Compute quantity from amount in "por monto" mode
  const computedQuantity = useMemo(() => {
    if (inputMode !== 'amount') return null
    const amt = parseFloat(amount)
    const p = parseFloat(price)
    if (!amt || !p || p === 0) return null
    return amt / p
  }, [inputMode, amount, price])

  // The effective quantity used for submission and cost preview
  const effectiveQuantity = inputMode === 'amount'
    ? (computedQuantity ?? 0)
    : (parseFloat(quantity) || 0)

  const effectivePrice = parseFloat(price) || 0
  const effectiveFees = parseFloat(fees) || 0
  const subtotal = effectiveQuantity * effectivePrice
  const totalCost = subtotal + effectiveFees

  function resetForm() {
    setSymbol('')
    setSearchQuery('')
    setQuantity('')
    setPrice('')
    setFees('0')
    setAmount('')
    setInputMode('quantity')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (effectiveQuantity <= 0) {
      toast.error('La cantidad calculada debe ser mayor a 0')
      return
    }

    setLoading(true)

    const res = await fetch('/api/transaction', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        portfolio_id: portfolioId,
        symbol: symbol.toUpperCase(),
        asset_type: assetType,
        type,
        quantity: effectiveQuantity,
        price: effectivePrice,
        fees: effectiveFees,
        currency,
        executed_at: new Date().toISOString(),
      }),
    })

    const data = await res.json()

    if (data.error) {
      toast.error(data.error)
      setLoading(false)
      return
    }

    toast.success('Transaccion registrada')
    mutate(`/api/portfolio/${portfolioId}`)
    setOpen(false)
    resetForm()
    setLoading(false)
  }

  function handleSymbolSelect(selectedSymbol: string) {
    setSymbol(selectedSymbol)
    setSearchQuery('')
  }

  const actionLabel = type === 'buy' ? 'Compraras' : type === 'sell' ? 'Venderas' : 'Recibiras'

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm() }}>
      <DialogTrigger className="inline-flex items-center justify-center rounded-md text-sm font-medium text-primary-foreground bg-primary hover:bg-primary/90 h-8 px-3 gap-1">
        <Plus className="h-4 w-4" /> Transaccion
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nueva Transaccion</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Tipo</Label>
              <Select value={type} onValueChange={(v) => v && setType(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="buy">Compra</SelectItem>
                  <SelectItem value="sell">Venta</SelectItem>
                  <SelectItem value="dividend">Dividendo</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Tipo de activo</Label>
              <Select value={assetType} onValueChange={(v) => v && setAssetType(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="stock">Accion</SelectItem>
                  <SelectItem value="etf">ETF</SelectItem>
                  <SelectItem value="crypto">Crypto</SelectItem>
                  <SelectItem value="bond">Bono/CETE</SelectItem>
                  <SelectItem value="forex">Forex</SelectItem>
                  <SelectItem value="commodity">Commodity</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Simbolo</Label>
            <Input
              value={symbol}
              onChange={e => { setSymbol(e.target.value); setSearchQuery(e.target.value) }}
              placeholder="AAPL, BTC-USD, AMXL.MX..."
              required
            />
            {searchResults && searchResults.length > 0 && searchQuery.length > 0 && symbol !== searchQuery && (
              <div className="border rounded-md mt-1 max-h-32 overflow-y-auto">
                {searchResults.slice(0, 5).map((r: { symbol: string; name: string; exchDisp: string }) => (
                  <button
                    key={r.symbol}
                    type="button"
                    className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted flex justify-between"
                    onClick={() => handleSymbolSelect(r.symbol)}
                  >
                    <span className="font-mono">{r.symbol}</span>
                    <span className="text-muted-foreground truncate ml-2">{r.name}</span>
                  </button>
                ))}
              </div>
            )}
            {resolvedSymbol && quote?.price != null && (
              <p className="text-xs text-muted-foreground mt-1">
                {resolvedSymbol} — <FormattedAmount value={quote.price} from={currency} className="font-medium text-foreground text-xs" /> {currency}
              </p>
            )}
            {resolvedSymbol && quoteLoading && (
              <p className="text-xs text-muted-foreground mt-1">Cargando precio...</p>
            )}
          </div>

          {/* Input mode toggle — only for buy/sell */}
          {(type === 'buy' || type === 'sell') && (
            <div className="flex rounded-md border overflow-hidden">
              <button
                type="button"
                className={cn(
                  'flex-1 px-3 py-1.5 text-sm font-medium transition-colors',
                  inputMode === 'quantity'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted/50 text-muted-foreground hover:bg-muted'
                )}
                onClick={() => setInputMode('quantity')}
              >
                Por Cantidad
              </button>
              <button
                type="button"
                className={cn(
                  'flex-1 px-3 py-1.5 text-sm font-medium transition-colors',
                  inputMode === 'amount'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted/50 text-muted-foreground hover:bg-muted'
                )}
                onClick={() => setInputMode('amount')}
              >
                Por Monto
              </button>
            </div>
          )}

          {inputMode === 'quantity' ? (
            /* Existing "by quantity" fields — unchanged */
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Cantidad</Label>
                <Input type="number" step="any" value={quantity} onChange={e => setQuantity(e.target.value)} required min="0.0001" />
              </div>
              <div className="space-y-2">
                <Label>Precio</Label>
                <Input type="number" step="any" value={price} onChange={e => setPrice(e.target.value)} required min="0.01" />
              </div>
            </div>
          ) : (
            /* New "by amount" fields */
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Monto ({currency})</Label>
                  <Input
                    type="number"
                    step="any"
                    value={amount}
                    onChange={e => setAmount(e.target.value)}
                    placeholder="5.00"
                    required
                    min="0.01"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Precio</Label>
                  <Input type="number" step="any" value={price} onChange={e => setPrice(e.target.value)} required min="0.01" />
                </div>
              </div>
              {computedQuantity != null && computedQuantity > 0 && (
                <p className="text-xs text-muted-foreground bg-muted/50 rounded-md px-3 py-2">
                  {actionLabel}{' '}
                  <span className="font-mono font-medium text-foreground">{computedQuantity.toFixed(6)}</span>{' '}
                  acciones de <span className="font-medium">{symbol.toUpperCase()}</span> a{' '}
                  <FormattedAmount value={effectivePrice} from={currency} className="text-xs" />/accion
                </p>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Comision</Label>
              <Input type="number" step="any" value={fees} onChange={e => setFees(e.target.value)} min="0" />
            </div>
            <div className="space-y-2">
              <Label>Moneda</Label>
              <Select value={currency} onValueChange={(v) => v && setCurrency(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="MXN">MXN</SelectItem>
                  <SelectItem value="USD">USD</SelectItem>
                  <SelectItem value="EUR">EUR</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Live cost preview with breakdown */}
          <div className="flex items-center justify-between pt-2 border-t">
            <div className="text-sm text-muted-foreground">
              {effectiveFees > 0 ? (
                <span>
                  Costo total:{' '}
                  <FormattedAmount value={subtotal} from={currency} className="text-sm" />
                  {' + '}
                  <FormattedAmount value={effectiveFees} from={currency} className="text-sm" />
                  {' comision = '}
                  <FormattedAmount value={totalCost} from={currency} className="font-medium text-foreground text-sm" />
                </span>
              ) : (
                <span>
                  Total: <FormattedAmount value={totalCost} from={currency} className="font-medium text-foreground text-sm" />
                </span>
              )}
            </div>
            <Button type="submit" disabled={loading}>
              {loading ? 'Guardando...' : 'Registrar'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
