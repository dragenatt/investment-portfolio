'use client'

import { useEffect, useRef } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { SkeletonCard } from '@/components/shared/skeleton-card'
import { useTradeHistory, type Transaction } from '@/lib/hooks/use-transactions'
import { formatCurrency } from '@/lib/utils/currency'
import { cn } from '@/lib/utils'

// 4.6. trade-history.ts replayed each position's transactions into what they
// mean — banked versus on-paper gains, the true cost after fees, the return
// given when each peso went in — and the transactions page showed only the
// ledger. The ledger and this summary read the same transactions; this one
// just adds them up.

const signedMoney = (value: number, currency: string) => `${value > 0 ? '+' : ''}${formatCurrency(value, currency)}`
const tone = (value: number) => (value > 0 ? 'text-gain' : value < 0 ? 'text-loss' : undefined)
const pct = (value: number | null) => (value === null || !Number.isFinite(value) ? '—' : `${value > 0 ? '+' : ''}${value.toFixed(2)}%`)

export function TradeHistorySummary({ portfolioId, transactions }: { portfolioId: string; transactions: Transaction[] | undefined }) {
  const { data, isLoading, error, mutate } = useTradeHistory(portfolioId)

  // Any edit to the ledger changes what it adds up to. The first load of the
  // ledger is not an edit, so it does not refetch.
  const seen = useRef<Transaction[] | undefined>(undefined)
  useEffect(() => {
    if (seen.current && transactions && transactions !== seen.current) void mutate()
    if (transactions) seen.current = transactions
  }, [transactions, mutate])

  return (
    <Card className="rounded-2xl">
      <CardHeader>
        <CardTitle className="text-base">Resultado por posición</CardTitle>
        <CardDescription>
          Lo realizado ya es dinero: salió de una venta o de un dividendo, y normalmente causa impuestos. Lo no realizado
          es una cotización y puede desaparecer antes de cobrarse. Cada cifra está en la moneda en que registraste el costo.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <SkeletonCard />
        ) : error ? (
          <p className="text-sm text-muted-foreground">No se pudo calcular el resultado de las posiciones.</p>
        ) : !data || data.positions.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin transacciones que sumar todavía.</p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              {data.totals.map((t) => (
                <dl key={t.currency} className="rounded-xl border border-border p-3 text-sm">
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Total en {t.currency}</p>
                  {(
                    [
                      ['Ganancia realizada', t.realizedPnl, true],
                      ['Ganancia no realizada', t.unrealizedPnl, true],
                      ['Dividendos cobrados', t.dividendsReceived, false],
                      ['Comisiones pagadas', t.totalFees, false],
                      ['Valor de mercado', t.marketValue, false],
                      ['Costo de lo que sigue en cartera', t.costBasis, false],
                    ] as Array<[string, number, boolean]>
                  ).map(([label, value, signed]) => (
                    <div key={label} className="flex justify-between gap-2 py-0.5">
                      <dt className="text-muted-foreground">{label}</dt>
                      <dd className={cn('font-financial', signed && tone(value))}>
                        {signed ? signedMoney(value, t.currency) : formatCurrency(value, t.currency)}
                      </dd>
                    </div>
                  ))}
                </dl>
              ))}
            </div>
            {data.totals.length > 1 && (
              <p className="text-xs text-muted-foreground">
                Hay costos registrados en más de una moneda; cada total se queda en la suya en lugar de sumar pesos con dólares.
              </p>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">Resultado de cada posición según sus transacciones</caption>
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th scope="col" className="py-2 pr-3 font-medium">Posición</th>
                    <th scope="col" className="py-2 pr-3 font-medium text-right">Unidades</th>
                    <th scope="col" className="py-2 pr-3 font-medium text-right">Costo promedio</th>
                    <th scope="col" className="py-2 pr-3 font-medium text-right">Valor</th>
                    <th scope="col" className="py-2 pr-3 font-medium text-right">Realizado</th>
                    <th scope="col" className="py-2 pr-3 font-medium text-right">No realizado</th>
                    <th scope="col" className="py-2 pr-3 font-medium text-right">Dividendos</th>
                    <th scope="col" className="py-2 font-medium text-right">Rendimiento anual (dinero)</th>
                  </tr>
                </thead>
                <tbody>
                  {data.positions.map((p) => (
                    <tr key={p.symbol} className="border-t border-border align-top">
                      <th scope="row" className="py-2 pr-3 text-left font-normal">
                        <span className="block font-mono">{p.symbol}</span>
                        {!p.priced && <span className="block text-[11px] text-warn">Sin cotización: valuada al costo</span>}
                        {p.unconverted && <span className="block text-[11px] text-warn">Precio sin convertir a {p.currency}</span>}
                      </th>
                      <td className="py-2 pr-3 text-right font-financial">{p.quantity}</td>
                      <td className="py-2 pr-3 text-right font-financial">{formatCurrency(p.avgCost, p.currency)}</td>
                      <td className="py-2 pr-3 text-right font-financial">{formatCurrency(p.marketValue, p.currency)}</td>
                      <td className={cn('py-2 pr-3 text-right font-financial', tone(p.realizedPnl))}>{signedMoney(p.realizedPnl, p.currency)}</td>
                      <td className={cn('py-2 pr-3 text-right font-financial', tone(p.unrealizedPnl))}>{signedMoney(p.unrealizedPnl, p.currency)}</td>
                      <td className="py-2 pr-3 text-right font-financial">{formatCurrency(p.dividendsReceived, p.currency)}</td>
                      <td className="py-2 text-right font-financial">{pct(p.mwrPct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="text-xs text-muted-foreground">
              El costo promedio incluye comisiones. El rendimiento anual (dinero) pondera cada aportación por cuánto tiempo
              estuvo invertida (TIR); en periodos cortos se dispara o se hunde con pocos días. Una cotización en otra moneda
              se convierte a la del costo al tipo de cambio de hoy.
            </p>

            {data.positions.some((p) => p.warnings.length > 0) && (
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground">Avisos sobre los datos</summary>
                <ul className="mt-1 list-disc space-y-1 pl-5">
                  {data.positions.flatMap((p) => p.warnings.map((w, i) => <li key={`${p.symbol}-${i}`}><span className="font-mono">{p.symbol}</span>: {w}</li>))}
                </ul>
              </details>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
