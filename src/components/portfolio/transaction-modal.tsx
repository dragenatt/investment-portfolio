'use client'

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useState, useEffect, useRef } from 'react'
import { useSWRConfig } from 'swr'
import { toast } from 'sonner'
import { Plus, ArrowRightLeft, Loader2 } from 'lucide-react'
import { useMarketSearch, useQuote } from '@/lib/hooks/use-market'
import { FormattedAmount } from '@/components/shared/formatted-amount'

type Props = { portfolioId: string }

/**
 * Smart transaction modal with linked fields:
 * - Enter amount → auto-calculates quantity
 * - Enter quantity → auto-calculates amount
 * - Change price → recalculates whichever you edited last
 * - Symbol selection → auto-fills current market price
 */
export function TransactionModal({ portfolioId }: Props) {
  const [open, setOpen] = useState(false)
  const [symbol, setSymbol] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [type, setType] = useState<string>('buy')
  const [assetType, setAssetType] = useState<string>('stock')
  const [quantity, setQuantity] = useState('')
  const [price, setPrice] = useState('')
  const [fees, setFees] = useState('0')
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState('USD')
  const [loading, setLoading] = useState(false)

  // Track which field the user edited last to know what to recalculate
  const lastEdited = useRef<'amount' | 'quantity'>('amount')

  const { mutate } = useSWRConfig()
  const { data: searchResults } = useMarketSearch(searchQuery)

  // Fetch current market price when a symbol is selected
  const resolvedSymbol = symbol && searchQuery === '' ? symbol : null
  const { data: quote, isLoading: quoteLoading } = useQuote(resolvedSymbol)

  // Auto-fill price when quote loads — uses ref to track if already filled
  const priceFilledRef = useRef(false)
  const quotePrice = quote?.price
  const quoteCurrency = quote?.currency
  useEffect(() => {
    if (quotePrice != null && resolvedSymbol && !priceFilledRef.current) {
      priceFilledRef.current = true
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: auto-fill from API data on first load only
      setPrice(String(quotePrice))
       
      if (quoteCurrency) setCurrency(quoteCurrency)
    }
    if (!resolvedSymbol) priceFilledRef.current = false
  }, [quotePrice, quoteCurrency, resolvedSymbol])

  // ── Linked field calculations ──────────────────────────────

  // When amount changes → calculate quantity
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

  // When quantity changes → calculate amount
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

  // When price changes → recalculate based on what was edited last
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

  // ── Computed values ────────────────────────────────────────

  const effectiveQuantity = parseFloat(quantity) || 0
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
    lastEdited.current = 'amount'
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (effectiveQuantity <= 0) {
      toast.error('La cantidad debe ser mayor a 0')
      return
    }
    if (effectivePrice <= 0) {
      toast.error('El precio debe ser mayor a 0')
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

    toast.success('Transacción registrada')
    mutate(`/api/portfolio/${portfolioId}`)
    setOpen(false)
    resetForm()
    setLoading(false)
  }

  function handleSymbolSelect(selectedSymbol: string) {
    setSymbol(selectedSymbol)
    setSearchQuery('')
  }

  const typeLabels: Record<string, string> = {
    buy: 'Comprarás',
    sell: 'Venderás',
    dividend: 'Recibirás',
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm() }}>
      <DialogTrigger className="inline-flex items-center justify-center rounded-md text-sm font-medium text-primary-foreground bg-primary hover:bg-primary/90 h-8 px-3 gap-1">
        <Plus className="h-4 w-4" /> Transacción
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nueva Transacción</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">

          {/* Row 1: Tipo + Activo */}
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
                  <SelectItem value="stock">Acción</SelectItem>
                  <SelectItem value="etf">ETF</SelectItem>
                  <SelectItem value="crypto">Crypto</SelectItem>
                  <SelectItem value="bond">Bono/CETE</SelectItem>
                  <SelectItem value="forex">Forex</SelectItem>
                  <SelectItem value="commodity">Commodity</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Row 2: Símbolo con autocomplete */}
          <div className="space-y-2">
            <Label>Símbolo</Label>
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
            {resolvedSymbol && quoteLoading && (
              <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" /> Obteniendo precio de mercado...
              </p>
            )}
          </div>

          {/* Row 3: Precio (auto-filled from market) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Precio por unidad</Label>
              {resolvedSymbol && quote?.price != null && (
                <span className="text-xs text-muted-foreground">
                  Mercado: <span className="font-mono font-medium text-foreground">${quote.price.toFixed(2)}</span> {quote.currency || currency}
                </span>
              )}
            </div>
            <Input
              type="number"
              step="any"
              value={price}
              onChange={e => handlePriceChange(e.target.value)}
              placeholder="Precio por acción/unidad"
              required
              min="0.01"
            />
          </div>

          {/* Row 4: Monto ↔ Cantidad (linked fields) */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <span>Ingresa uno y el otro se calcula automáticamente</span>
            </div>
            <div className="grid grid-cols-[1fr,auto,1fr] gap-2 items-end">
              <div className="space-y-1.5">
                <Label className="text-xs">
                  Monto ({currency})
                </Label>
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
                <Label className="text-xs">
                  Cantidad (acciones)
                </Label>
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

          {/* Row 5: Comisión + Moneda */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Comisión</Label>
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

          {/* Preview + Submit */}
          <div className="rounded-lg bg-muted/50 p-3 space-y-1">
            {effectiveQuantity > 0 && effectivePrice > 0 && (
              <p className="text-sm">
                {typeLabels[type] || 'Registrarás'}{' '}
                <span className="font-mono font-semibold">{effectiveQuantity.toFixed(6)}</span>{' '}
                {symbol ? <>de <span className="font-semibold">{symbol.toUpperCase()}</span></> : 'acciones'}{' '}
                a <FormattedAmount value={effectivePrice} from={currency} className="text-sm font-semibold" />/unidad
              </p>
            )}
            <div className="flex items-center justify-between pt-1">
              <div className="text-sm text-muted-foreground">
                {effectiveFees > 0 ? (
                  <span>
                    <FormattedAmount value={subtotal} from={currency} className="text-sm" />
                    {' + '}
                    <FormattedAmount value={effectiveFees} from={currency} className="text-sm" />
                    {' comisión = '}
                    <span className="font-semibold text-foreground">
                      <FormattedAmount value={totalCost} from={currency} className="text-sm" />
                    </span>
                  </span>
                ) : (
                  <span>
                    Total:{' '}
                    <span className="font-semibold text-foreground">
                      <FormattedAmount value={totalCost} from={currency} className="text-sm" />
                    </span>
                  </span>
                )}
              </div>
              <Button type="submit" disabled={loading || effectiveQuantity <= 0}>
                {loading ? (
                  <><Loader2 className="h-4 w-4 animate-spin mr-1" /> Guardando...</>
                ) : (
                  'Registrar'
                )}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
