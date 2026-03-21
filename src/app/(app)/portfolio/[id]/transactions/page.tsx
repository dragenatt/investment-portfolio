'use client'

import { use, useState } from 'react'
import { useTransactions, type Transaction } from '@/lib/hooks/use-transactions'
import { TransactionEditModal } from '@/components/portfolio/transaction-edit-modal'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SkeletonTable } from '@/components/shared/skeleton-table'
import { Pencil, Trash2, ArrowLeft } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { useSWRConfig } from 'swr'
import { toast } from 'sonner'
import Link from 'next/link'

const TYPE_LABELS: Record<string, string> = {
  buy: 'Compra',
  sell: 'Venta',
  dividend: 'Dividendo',
  split: 'Split',
}

const TYPE_COLORS: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  buy: 'default',
  sell: 'destructive',
  dividend: 'secondary',
  split: 'outline',
}

const PAGE_SIZE = 20

export default function TransactionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { data: transactions, isLoading } = useTransactions(id)
  const { mutate } = useSWRConfig()
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [symbolFilter, setSymbolFilter] = useState<string>('all')
  const [page, setPage] = useState(0)
  const [editing, setEditing] = useState<Transaction | null>(null)
  const [deleting, setDeleting] = useState<Transaction | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)

  const symbols = [...new Set((transactions || []).map(t => t.position.symbol))].sort()

  const filtered = (transactions || []).filter(t => {
    if (typeFilter !== 'all' && t.type !== typeFilter) return false
    if (symbolFilter !== 'all' && t.position.symbol !== symbolFilter) return false
    return true
  })

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)
  const paginated = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  const handleDelete = async () => {
    if (!deleting) return
    setDeleteLoading(true)
    try {
      const res = await fetch(`/api/transaction/${deleting.id}`, { method: 'DELETE' })
      const data = await res.json()
      if (data.error) {
        toast.error(data.error)
      } else {
        toast.success('Transaccion eliminada')
        mutate(`/api/transaction?pid=${id}`)
        mutate(`/api/portfolio/${id}`)
        setDeleting(null)
      }
    } finally {
      setDeleteLoading(false)
    }
  }

  if (isLoading) return <SkeletonTable />

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href={`/portfolio/${id}`}>
          <Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" /> Volver</Button>
        </Link>
        <h1 className="text-2xl font-bold">Transacciones</h1>
      </div>

      <div className="flex gap-3">
        <Select value={typeFilter} onValueChange={v => { if (v) { setTypeFilter(v); setPage(0) } }}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Tipo" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los tipos</SelectItem>
            <SelectItem value="buy">Compra</SelectItem>
            <SelectItem value="sell">Venta</SelectItem>
            <SelectItem value="dividend">Dividendo</SelectItem>
            <SelectItem value="split">Split</SelectItem>
          </SelectContent>
        </Select>
        <Select value={symbolFilter} onValueChange={v => { if (v) { setSymbolFilter(v); setPage(0) } }}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Simbolo" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            {symbols.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">No hay transacciones</p>
          ) : (
            <>
              <div className="hidden md:block">
                <table className="w-full">
                  <thead>
                    <tr className="border-b text-left text-sm text-muted-foreground">
                      <th className="p-3">Fecha</th>
                      <th className="p-3">Simbolo</th>
                      <th className="p-3">Tipo</th>
                      <th className="p-3 text-right">Cantidad</th>
                      <th className="p-3 text-right">Precio</th>
                      <th className="p-3 text-right">Comisiones</th>
                      <th className="p-3 text-right">Total</th>
                      <th className="p-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginated.map(t => (
                      <tr key={t.id} className="border-b hover:bg-muted/50">
                        <td className="p-3 text-sm">{new Date(t.executed_at).toLocaleDateString('es-MX')}</td>
                        <td className="p-3 font-mono text-sm font-medium">{t.position.symbol}</td>
                        <td className="p-3"><Badge variant={TYPE_COLORS[t.type]}>{TYPE_LABELS[t.type]}</Badge></td>
                        <td className="p-3 text-right font-mono text-sm">{t.quantity}</td>
                        <td className="p-3 text-right font-mono text-sm">${t.price.toFixed(2)}</td>
                        <td className="p-3 text-right font-mono text-sm">${t.fees.toFixed(2)}</td>
                        <td className="p-3 text-right font-mono text-sm font-medium">${(t.quantity * t.price + t.fees).toFixed(2)}</td>
                        <td className="p-3">
                          <div className="flex gap-1">
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditing(t)}>
                              <Pencil className="h-3 w-3" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500" onClick={() => setDeleting(t)}>
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="md:hidden divide-y">
                {paginated.map(t => (
                  <div key={t.id} className="p-3 space-y-1">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-medium text-sm">{t.position.symbol}</span>
                        <Badge variant={TYPE_COLORS[t.type]} className="text-xs">{TYPE_LABELS[t.type]}</Badge>
                      </div>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditing(t)}>
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500" onClick={() => setDeleting(t)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                    <div className="flex justify-between text-sm text-muted-foreground">
                      <span>{new Date(t.executed_at).toLocaleDateString('es-MX')}</span>
                      <span className="font-mono">{t.quantity} x ${t.price.toFixed(2)}</span>
                    </div>
                    <div className="text-right font-mono text-sm font-medium">${(t.quantity * t.price + t.fees).toFixed(2)}</div>
                  </div>
                ))}
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-between p-3 border-t">
                  <span className="text-sm text-muted-foreground">{filtered.length} transacciones</span>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Anterior</Button>
                    <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>Siguiente</Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {editing && (
        <TransactionEditModal
          transaction={editing}
          open={!!editing}
          onOpenChange={(open) => { if (!open) setEditing(null) }}
        />
      )}

      <Dialog open={!!deleting} onOpenChange={(open) => { if (!open) setDeleting(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Eliminar transaccion</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Eliminar esta transaccion de {deleting?.quantity} {deleting?.position.symbol}? Esta accion no se puede deshacer.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>Cancelar</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleteLoading}>
              {deleteLoading ? 'Eliminando...' : 'Eliminar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
