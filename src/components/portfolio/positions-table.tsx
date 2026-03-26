'use client'

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useCurrency } from '@/lib/hooks/use-currency'
import { formatNumber } from '@/lib/utils/numbers'
import { FormattedAmount } from '@/components/shared/formatted-amount'
import { PercentageChange } from '@/components/shared/percentage-change'
import { useState } from 'react'
import { ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'

type Position = {
  id: string
  symbol: string
  name?: string
  asset_type: string
  quantity: number
  avg_cost: number
  currency: string
  currentPrice?: number
  /** Currency of the currentPrice (from Yahoo Finance) */
  priceCurrency?: string
  changePct?: number
}

type SortKey = 'symbol' | 'quantity' | 'avg_cost' | 'currentPrice' | 'value' | 'gainLoss' | 'gainPct'

export function PositionsTable({ positions }: { positions: Position[] }) {
  const { convert } = useCurrency()
  const router = useRouter()
  const [sortKey, setSortKey] = useState<SortKey>('value')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  function getPositionCalcs(pos: Position) {
    const priceCur = pos.priceCurrency || pos.currency
    const costCur = pos.currency
    const currentPrice = pos.currentPrice ?? pos.avg_cost
    const priceConverted = convert(currentPrice, priceCur)
    const costConverted = convert(pos.avg_cost, costCur)
    const value = pos.quantity * priceConverted
    const totalCost = pos.quantity * costConverted
    const gainLoss = value - totalCost
    const gainPct = costConverted > 0 ? ((priceConverted - costConverted) / costConverted) * 100 : 0
    return { priceCur, costCur, currentPrice, priceConverted, costConverted, value, totalCost, gainLoss, gainPct }
  }

  const sorted = [...positions].filter(p => p.quantity > 0).sort((a, b) => {
    const calcA = getPositionCalcs(a)
    const calcB = getPositionCalcs(b)

    const getValue = (p: Position, calc: ReturnType<typeof getPositionCalcs>) => {
      switch (sortKey) {
        case 'symbol': return p.symbol
        case 'quantity': return p.quantity
        case 'avg_cost': return calc.costConverted
        case 'currentPrice': return calc.priceConverted
        case 'value': return calc.value
        case 'gainLoss': return calc.gainLoss
        case 'gainPct': return calc.gainPct
      }
    }
    const va = getValue(a, calcA)
    const vb = getValue(b, calcB)
    const cmp = va < vb ? -1 : va > vb ? 1 : 0
    return sortDir === 'asc' ? cmp : -cmp
  })

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }

  const SortIcon = ({ k }: { k: SortKey }) => {
    if (sortKey !== k) return <ArrowUpDown className="ml-1 h-3 w-3 opacity-40" />
    return sortDir === 'asc'
      ? <ArrowUp className="ml-1 h-3 w-3" />
      : <ArrowDown className="ml-1 h-3 w-3" />
  }

  const SortHeader = ({ k, children, className }: { k: SortKey; children: React.ReactNode; className?: string }) => (
    <button
      className={cn(
        'inline-flex items-center gap-0.5 text-xs font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground transition-colors',
        className,
      )}
      onClick={() => toggleSort(k)}
    >
      {children}
      <SortIcon k={k} />
    </button>
  )

  const handleRowClick = (symbol: string) => {
    router.push(`/market/${encodeURIComponent(symbol)}`)
  }

  return (
    <>
      {/* Desktop table */}
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead><SortHeader k="symbol">Símbolo</SortHeader></TableHead>
              <TableHead className="text-right"><SortHeader k="quantity" className="justify-end">Cantidad</SortHeader></TableHead>
              <TableHead className="text-right"><SortHeader k="avg_cost" className="justify-end">Precio Prom.</SortHeader></TableHead>
              <TableHead className="text-right"><SortHeader k="currentPrice" className="justify-end">Precio Actual</SortHeader></TableHead>
              <TableHead className="text-right"><SortHeader k="value" className="justify-end">Valor</SortHeader></TableHead>
              <TableHead className="text-right"><SortHeader k="gainLoss" className="justify-end">G/P $</SortHeader></TableHead>
              <TableHead className="text-right"><SortHeader k="gainPct" className="justify-end">G/P %</SortHeader></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map(pos => {
              const { priceCur, costCur, currentPrice, value, gainLoss, gainPct } = getPositionCalcs(pos)

              return (
                <TableRow
                  key={pos.id}
                  className="cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => handleRowClick(pos.symbol)}
                >
                  <TableCell>
                    <div>
                      <span className="font-semibold font-mono">{pos.symbol}</span>
                      {pos.name && (
                        <p className="text-xs text-muted-foreground truncate max-w-[160px]">{pos.name}</p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-mono">{formatNumber(pos.quantity, 4)}</TableCell>
                  <TableCell className="text-right"><FormattedAmount value={pos.avg_cost} from={costCur} /></TableCell>
                  <TableCell className="text-right">
                    <FormattedAmount value={currentPrice} from={priceCur} />
                  </TableCell>
                  <TableCell className="text-right font-semibold"><FormattedAmount value={value} /></TableCell>
                  <TableCell className="text-right">
                    <FormattedAmount value={gainLoss} colorize showSign className="font-bold" />
                  </TableCell>
                  <TableCell className="text-right">
                    <PercentageChange value={gainPct} className="font-bold" />
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-2">
        {sorted.map(pos => {
          const { priceCur, currentPrice, value, gainLoss, gainPct } = getPositionCalcs(pos)

          return (
            <div
              key={pos.id}
              className="border border-border rounded-2xl p-3 cursor-pointer hover:bg-muted/50 active:scale-[0.99] transition-all"
              onClick={() => handleRowClick(pos.symbol)}
            >
              <div className="flex justify-between items-start">
                <div>
                  <p className="font-semibold font-mono text-sm">{pos.symbol}</p>
                  {pos.name && (
                    <p className="text-xs text-muted-foreground truncate max-w-[140px]">{pos.name}</p>
                  )}
                  <p className="text-xs text-muted-foreground mt-1">
                    {formatNumber(pos.quantity, 4)} @ <FormattedAmount value={currentPrice} from={priceCur} />
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-semibold text-sm"><FormattedAmount value={value} /></p>
                  <FormattedAmount value={gainLoss} colorize showSign className="text-xs font-bold" />
                  <p className="text-xs mt-0.5">
                    <PercentageChange value={gainPct} className="font-bold" />
                  </p>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}
