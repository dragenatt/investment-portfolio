'use client'

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { useCurrency } from '@/lib/hooks/use-currency'
import { formatNumber } from '@/lib/utils/numbers'
import { useState } from 'react'
import { ArrowUpDown } from 'lucide-react'
import { Button } from '@/components/ui/button'

type Position = {
  id: string
  symbol: string
  asset_type: string
  quantity: number
  avg_cost: number
  currency: string
  currentPrice?: number
  changePct?: number
}

type SortKey = 'symbol' | 'quantity' | 'avg_cost' | 'value'

export function PositionsTable({ positions }: { positions: Position[] }) {
  const { format } = useCurrency()
  const [sortKey, setSortKey] = useState<SortKey>('value')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const sorted = [...positions].filter(p => p.quantity > 0).sort((a, b) => {
    const getValue = (p: Position) => {
      switch (sortKey) {
        case 'symbol': return p.symbol
        case 'quantity': return p.quantity
        case 'avg_cost': return p.avg_cost
        case 'value': return p.quantity * (p.currentPrice ?? p.avg_cost)
      }
    }
    const va = getValue(a)
    const vb = getValue(b)
    const cmp = va < vb ? -1 : va > vb ? 1 : 0
    return sortDir === 'asc' ? cmp : -cmp
  })

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }

  const SortHeader = ({ k, children }: { k: SortKey; children: React.ReactNode }) => (
    <Button variant="ghost" size="sm" className="-ml-3 h-8" onClick={() => toggleSort(k)}>
      {children}
      <ArrowUpDown className="ml-1 h-3 w-3" />
    </Button>
  )

  return (
    <>
      {/* Desktop table */}
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead><SortHeader k="symbol">Simbolo</SortHeader></TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead className="text-right"><SortHeader k="quantity">Cantidad</SortHeader></TableHead>
              <TableHead className="text-right"><SortHeader k="avg_cost">Costo Prom.</SortHeader></TableHead>
              <TableHead className="text-right">Precio Actual</TableHead>
              <TableHead className="text-right"><SortHeader k="value">Valor</SortHeader></TableHead>
              <TableHead className="text-right">Ganancia</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map(pos => (
              <TableRow key={pos.id}>
                <TableCell className="font-medium font-mono">{pos.symbol}</TableCell>
                <TableCell><Badge variant="outline" className="text-xs">{pos.asset_type}</Badge></TableCell>
                <TableCell className="text-right font-mono">{formatNumber(pos.quantity, 4)}</TableCell>
                <TableCell className="text-right font-mono">{format(pos.avg_cost, pos.currency)}</TableCell>
                <TableCell className="text-right font-mono">{format(pos.currentPrice ?? pos.avg_cost, pos.currency)}</TableCell>
                <TableCell className="text-right font-mono font-medium">{format(pos.quantity * (pos.currentPrice ?? pos.avg_cost), pos.currency)}</TableCell>
                <TableCell className={`text-right font-mono text-sm ${((pos.currentPrice ?? pos.avg_cost) - pos.avg_cost) >= 0 ? 'text-gain' : 'text-loss'}`}>
                  {((pos.currentPrice ?? pos.avg_cost) - pos.avg_cost) >= 0 ? '+' : ''}{formatNumber(((pos.currentPrice ?? pos.avg_cost) - pos.avg_cost) / (pos.avg_cost || 1) * 100)}%
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-3">
        {sorted.map(pos => (
          <div key={pos.id} className="border border-border rounded-2xl p-3">
            <div className="flex justify-between items-start">
              <div>
                <p className="font-medium font-mono">{pos.symbol}</p>
                <Badge variant="outline" className="text-xs mt-1">{pos.asset_type}</Badge>
              </div>
              <div className="text-right">
                <p className="font-mono font-medium">{format(pos.quantity * (pos.currentPrice ?? pos.avg_cost), pos.currency)}</p>
                <p className="text-xs text-muted-foreground">{formatNumber(pos.quantity, 4)} @ {format(pos.currentPrice ?? pos.avg_cost, pos.currency)}</p>
                <p className={`text-xs font-mono ${((pos.currentPrice ?? pos.avg_cost) - pos.avg_cost) >= 0 ? 'text-gain' : 'text-loss'}`}>
                  {((pos.currentPrice ?? pos.avg_cost) - pos.avg_cost) >= 0 ? '+' : ''}{formatNumber(((pos.currentPrice ?? pos.avg_cost) - pos.avg_cost) / (pos.avg_cost || 1) * 100)}%
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
