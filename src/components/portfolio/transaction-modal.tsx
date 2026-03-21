'use client'

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useState } from 'react'
import { useSWRConfig } from 'swr'
import { toast } from 'sonner'
import { Plus } from 'lucide-react'
import { useMarketSearch } from '@/lib/hooks/use-market'
import { useCurrency } from '@/lib/hooks/use-currency'

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
  const { mutate } = useSWRConfig()
  const { data: searchResults } = useMarketSearch(searchQuery)
  const { format } = useCurrency()

  const totalCost = (parseFloat(quantity) || 0) * (parseFloat(price) || 0) + (parseFloat(fees) || 0)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)

    const res = await fetch('/api/transaction', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        portfolio_id: portfolioId,
        symbol: symbol.toUpperCase(),
        asset_type: assetType,
        type,
        quantity: parseFloat(quantity),
        price: parseFloat(price),
        fees: parseFloat(fees) || 0,
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
    setSymbol('')
    setQuantity('')
    setPrice('')
    setFees('0')
    setLoading(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
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
                    onClick={() => { setSymbol(r.symbol); setSearchQuery('') }}
                  >
                    <span className="font-mono">{r.symbol}</span>
                    <span className="text-muted-foreground truncate ml-2">{r.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

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

          <div className="flex items-center justify-between pt-2 border-t">
            <div className="text-sm text-muted-foreground">
              Total: <span className="font-mono font-medium text-foreground">{format(totalCost, currency)}</span>
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
