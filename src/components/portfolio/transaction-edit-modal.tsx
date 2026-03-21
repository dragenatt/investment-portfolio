'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import { useSWRConfig } from 'swr'
import type { Transaction } from '@/lib/hooks/use-transactions'

type Props = {
  transaction: Transaction
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function TransactionEditModal({ transaction, open, onOpenChange }: Props) {
  const { mutate } = useSWRConfig()
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    type: transaction.type,
    quantity: transaction.quantity.toString(),
    price: transaction.price.toString(),
    fees: transaction.fees.toString(),
    currency: transaction.currency,
    executed_at: transaction.executed_at.slice(0, 16),
    notes: transaction.notes || '',
  })

  const handleSave = async () => {
    setSaving(true)
    try {
      const body: Record<string, unknown> = {}
      if (form.type !== transaction.type) body.type = form.type
      if (parseFloat(form.quantity) !== transaction.quantity) body.quantity = parseFloat(form.quantity)
      if (parseFloat(form.price) !== transaction.price) body.price = parseFloat(form.price)
      if (parseFloat(form.fees) !== transaction.fees) body.fees = parseFloat(form.fees)
      if (form.currency !== transaction.currency) body.currency = form.currency
      if (form.executed_at + ':00Z' !== transaction.executed_at) body.executed_at = form.executed_at + ':00Z'
      if (form.notes !== (transaction.notes || '')) body.notes = form.notes

      if (Object.keys(body).length === 0) {
        onOpenChange(false)
        return
      }

      const res = await fetch(`/api/transaction/${transaction.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (data.error) {
        toast.error(data.error)
      } else {
        toast.success('Transaccion actualizada')
        mutate(`/api/transaction?pid=${transaction.position.portfolio_id}`)
        mutate(`/api/portfolio/${transaction.position.portfolio_id}`)
        onOpenChange(false)
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar Transaccion — {transaction.position.symbol}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Tipo</Label>
            <Select value={form.type} onValueChange={v => { if (v) setForm(f => ({ ...f, type: v as typeof f.type })) }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="buy">Compra</SelectItem>
                <SelectItem value="sell">Venta</SelectItem>
                <SelectItem value="dividend">Dividendo</SelectItem>
                <SelectItem value="split">Split</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Cantidad</Label>
              <Input type="number" step="any" value={form.quantity} onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))} />
            </div>
            <div>
              <Label>Precio</Label>
              <Input type="number" step="any" value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Comisiones</Label>
              <Input type="number" step="any" value={form.fees} onChange={e => setForm(f => ({ ...f, fees: e.target.value }))} />
            </div>
            <div>
              <Label>Moneda</Label>
              <Select value={form.currency} onValueChange={v => { if (v) setForm(f => ({ ...f, currency: v })) }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="MXN">MXN</SelectItem>
                  <SelectItem value="USD">USD</SelectItem>
                  <SelectItem value="EUR">EUR</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Fecha de ejecucion</Label>
            <Input type="datetime-local" value={form.executed_at} onChange={e => setForm(f => ({ ...f, executed_at: e.target.value }))} />
          </div>
          <div>
            <Label>Notas</Label>
            <Input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Opcional..." />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Guardando...' : 'Guardar'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
