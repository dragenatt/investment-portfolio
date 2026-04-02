'use client'

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useState } from 'react'
import { useSWRConfig } from 'swr'
import { toast } from 'sonner'
import { Plus, Loader2 } from 'lucide-react'
import { useTranslation } from '@/lib/i18n'

export function CreateAlertModal() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [symbol, setSymbol] = useState('')
  const [condition, setCondition] = useState('')
  const [targetValue, setTargetValue] = useState('')
  const [loading, setLoading] = useState(false)

  const { mutate } = useSWRConfig()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!symbol || !condition || !targetValue) {
      toast.error(t.common.error)
      return
    }

    setLoading(true)
    try {
      const response = await fetch('/api/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: symbol.toUpperCase(),
          condition,
          target_value: parseFloat(targetValue),
        }),
      })

      const result = await response.json()

      if (!response.ok) {
        toast.error(result.error || t.common.error)
        return
      }

      toast.success(t.common.success)
      setSymbol('')
      setCondition('')
      setTargetValue('')
      setOpen(false)

      // Refresh the alerts list
      mutate('/api/alerts')
    } catch {
      toast.error(t.common.error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger>
        <Button className="rounded-xl gap-2">
          <Plus className="h-4 w-4" />
          {t.dashboard.alert}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.alerts.title}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="symbol">{t.trade.symbol}</Label>
            <Input
              id="symbol"
              placeholder="AAPL"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value.toUpperCase())}
              disabled={loading}
              maxLength={20}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="condition">Condición</Label>
            <Select value={condition} onValueChange={(val) => val && setCondition(val)} disabled={loading}>
              <SelectTrigger>
                <SelectValue placeholder="Selecciona una condición" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="above">Sube a</SelectItem>
                <SelectItem value="below">Baja a</SelectItem>
                <SelectItem value="pct_change_daily">Cambio % diario</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="targetValue">Valor Objetivo</Label>
            <Input
              id="targetValue"
              type="number"
              placeholder="0.00"
              step="0.01"
              value={targetValue}
              onChange={(e) => setTargetValue(e.target.value)}
              disabled={loading}
            />
          </div>

          <div className="flex gap-2 justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={loading}
            >
              {t.common.cancel}
            </Button>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {t.common.save}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
