'use client'

import { use, useState } from 'react'
import { useTransactions, type Transaction } from '@/lib/hooks/use-transactions'
import { formatCurrency } from '@/lib/utils/currency'
import { DIRECTION_LABEL, transactionCash } from '@/lib/utils/transaction-display'
import { TransactionEditModal } from '@/components/portfolio/transaction-edit-modal'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SkeletonTable } from '@/components/shared/skeleton-table'
import { ErrorDisplay } from '@/components/shared/error-display'
import { Pencil, Trash2, ArrowLeft } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { useSWRConfig } from 'swr'
import { toast } from 'sonner'
import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button-variants'
import { useTranslation } from '@/lib/i18n'

// A sale is not a loss: red belongs to losses in this app, and the label already
// names the type (C9).
const TYPE_COLORS: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  buy: 'default',
  sell: 'secondary',
  dividend: 'outline',
  split: 'outline',
}

/** "1,005.00 USD pagado" — the transaction's own currency, and which way the money went. */
function cashLabel(t: Transaction): string {
  const cash = transactionCash(t)
  return cash ? `${formatCurrency(cash.amount, t.currency)} ${DIRECTION_LABEL[cash.direction]}` : '—'
}

const PAGE_SIZE = 20

export default function TransactionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { t } = useTranslation()
  const { id } = use(params)

  const TYPE_LABELS: Record<string, string> = {
    buy: t.portfolio.buy,
    sell: t.portfolio.sell,
    dividend: t.portfolio.dividend,
    split: t.portfolio.split,
  }
  const { data: transactions, isLoading, error } = useTransactions(id)
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
        toast.success(t.portfolio.transaction_deleted)
        mutate(`/api/transaction?pid=${id}`)
        mutate(`/api/portfolio/${id}`)
        setDeleting(null)
      }
    } finally {
      setDeleteLoading(false)
    }
  }

  if (isLoading) return <SkeletonTable />
  // A failed load used to read "no transactions" (C9).
  if (error && !transactions) {
    return <ErrorDisplay error="No se pudieron cargar las transacciones. Tus datos no se han perdido; vuelve a intentarlo." onRetry={() => window.location.reload()} />
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href={`/portfolio/${id}`} className={buttonVariants({ variant: 'ghost', size: 'sm' })}><ArrowLeft className="h-4 w-4 mr-1" /> {t.common.back}</Link>
        <h1 className="text-2xl font-bold">{t.portfolio.transactions}</h1>
      </div>

      <div className="flex gap-3">
        <Select value={typeFilter} onValueChange={v => { if (v) { setTypeFilter(v); setPage(0) } }}>
          <SelectTrigger className="w-40" aria-label={t.portfolio.type}><SelectValue placeholder={t.portfolio.type} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t.portfolio.all_types}</SelectItem>
            <SelectItem value="buy">{t.portfolio.buy}</SelectItem>
            <SelectItem value="sell">{t.portfolio.sell}</SelectItem>
            <SelectItem value="dividend">{t.portfolio.dividend}</SelectItem>
            <SelectItem value="split">{t.portfolio.split}</SelectItem>
          </SelectContent>
        </Select>
        <Select value={symbolFilter} onValueChange={v => { if (v) { setSymbolFilter(v); setPage(0) } }}>
          <SelectTrigger className="w-40" aria-label={t.portfolio.symbol}><SelectValue placeholder={t.portfolio.symbol} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t.portfolio.all}</SelectItem>
            {symbols.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">{t.portfolio.no_transactions}</p>
          ) : (
            <>
              <div className="hidden md:block">
                <table className="w-full">
                  <thead>
                    <tr className="border-b text-left text-sm text-muted-foreground">
                      <th scope="col" className="p-3">{t.portfolio.date}</th>
                      <th scope="col" className="p-3">{t.portfolio.symbol}</th>
                      <th scope="col" className="p-3">{t.portfolio.type}</th>
                      <th scope="col" className="p-3 text-right">{t.portfolio.quantity}</th>
                      <th scope="col" className="p-3 text-right">{t.portfolio.price}</th>
                      <th scope="col" className="p-3 text-right">{t.portfolio.fees}</th>
                      <th scope="col" className="p-3 text-right">{t.portfolio.total}</th>
                      <th scope="col" className="p-3"><span className="sr-only">Acciones</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginated.map(t => (
                      <tr key={t.id} className="border-b hover:bg-muted/50">
                        <td className="p-3 text-sm">{new Date(t.executed_at).toLocaleDateString('es-MX')}</td>
                        <td className="p-3 font-mono text-sm font-medium">{t.position.symbol}</td>
                        <td className="p-3"><Badge variant={TYPE_COLORS[t.type]}>{TYPE_LABELS[t.type]}</Badge></td>
                        <td className="p-3 text-right font-financial text-sm">{t.quantity}</td>
                        <td className="p-3 text-right font-financial text-sm">{formatCurrency(t.price, t.currency)}</td>
                        <td className="p-3 text-right font-financial text-sm">{formatCurrency(t.fees, t.currency)}</td>
                        <td className="p-3 text-right font-financial text-sm font-medium">{cashLabel(t)}</td>
                        <td className="p-3">
                          <div className="flex gap-1">
                            <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`Editar transacción de ${t.position.symbol}`} onClick={() => setEditing(t)}>
                              <Pencil className="h-3 w-3" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" aria-label={`Eliminar transacción de ${t.position.symbol}`} onClick={() => setDeleting(t)}>
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
                        <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`Editar transacción de ${t.position.symbol}`} onClick={() => setEditing(t)}>
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" aria-label={`Eliminar transacción de ${t.position.symbol}`} onClick={() => setDeleting(t)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                    <div className="flex justify-between text-sm text-muted-foreground">
                      <span>{new Date(t.executed_at).toLocaleDateString('es-MX')}</span>
                      <span className="font-financial">{t.quantity} x {formatCurrency(t.price, t.currency)}</span>
                    </div>
                    <div className="text-right font-financial text-sm font-medium">{cashLabel(t)}</div>
                  </div>
                ))}
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-between p-3 border-t">
                  <span className="text-sm text-muted-foreground">{filtered.length} {t.portfolio.transactions}</span>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>{t.common.previous}</Button>
                    <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>{t.common.next}</Button>
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
            <DialogTitle>{t.portfolio.delete_transaction}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {t.portfolio.delete_transaction} {deleting?.quantity} {deleting?.position.symbol}? {t.portfolio.action_irreversible}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>{t.common.cancel}</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleteLoading}>
              {deleteLoading ? t.common.delete : t.common.delete}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
