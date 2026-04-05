'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowUp, ArrowDown, ArrowUpDown, AlertTriangle } from 'lucide-react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { FormattedAmount } from '@/components/shared/formatted-amount'
import { PercentageChange } from '@/components/shared/percentage-change'
import { cn } from '@/lib/utils'
import { formatNumber } from '@/lib/utils/numbers'

type PositionWithPnL = {
  id: string
  symbol: string
  name?: string
  asset_type: string
  quantity: number
  avg_cost: number
  currency: string
  current_price: number
  market_value: number
  pnl_absolute: number
  pnl_percent: number
  daily_change: number
  daily_change_pct: number
  sparkline_7d: number[]
  is_stale?: boolean
}

type Props = {
  positions: PositionWithPnL[]
}

type SortKey =
  | 'symbol'
  | 'quantity'
  | 'avg_cost'
  | 'current_price'
  | 'market_value'
  | 'pnl_absolute'
  | 'pnl_percent'
  | 'daily_change'

function Sparkline({ data, width = 48, height = 16 }: { data: number[]; width?: number; height?: number }) {
  if (!data || data.length < 2) return null
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * width
      const y = height - ((v - min) / range) * height
      return `${x},${y}`
    })
    .join(' ')
  const isPositive = data[data.length - 1] >= data[0]
  const color = isPositive ? 'var(--good, #10b981)' : 'var(--bad, #ef4444)'
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function SortIcon({ k, sortKey, sortDir }: { k: SortKey; sortKey: SortKey; sortDir: 'asc' | 'desc' }) {
  if (sortKey !== k) return <ArrowUpDown className="ml-1 h-3 w-3 opacity-40" />
  return sortDir === 'asc'
    ? <ArrowUp className="ml-1 h-3 w-3" />
    : <ArrowDown className="ml-1 h-3 w-3" />
}

function SortHeader({ k, children, className, sortKey, sortDir, onToggle }: {
  k: SortKey; children: React.ReactNode; className?: string
  sortKey: SortKey; sortDir: 'asc' | 'desc'; onToggle: (k: SortKey) => void
}) {
  return (
    <button
      className={cn(
        'inline-flex items-center gap-0.5 text-xs font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground transition-colors',
        className,
      )}
      onClick={() => onToggle(k)}
    >
      {children}
      <SortIcon k={k} sortKey={sortKey} sortDir={sortDir} />
    </button>
  )
}

export function PositionPnLTable({ positions }: Props) {
  const router = useRouter()
  const [sortKey, setSortKey] = useState<SortKey>('market_value')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const sorted = [...positions].sort((a, b) => {
    const getValue = (p: PositionWithPnL): string | number => {
      switch (sortKey) {
        case 'symbol': return p.symbol
        case 'quantity': return p.quantity
        case 'avg_cost': return p.avg_cost
        case 'current_price': return p.current_price
        case 'market_value': return p.market_value
        case 'pnl_absolute': return p.pnl_absolute
        case 'pnl_percent': return p.pnl_percent
        case 'daily_change': return p.daily_change
      }
    }
    const va = getValue(a)
    const vb = getValue(b)
    const cmp = va < vb ? -1 : va > vb ? 1 : 0
    return sortDir === 'asc' ? cmp : -cmp
  })

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir('desc') }
  }

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
              <TableHead>
                <SortHeader sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} k="symbol">
                  Simbolo
                </SortHeader>
              </TableHead>
              <TableHead className="text-right">
                <SortHeader sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} k="quantity" className="justify-end">
                  Cant.
                </SortHeader>
              </TableHead>
              <TableHead className="text-right">
                <SortHeader sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} k="avg_cost" className="justify-end">
                  Costo Prom.
                </SortHeader>
              </TableHead>
              <TableHead className="text-right">
                <SortHeader sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} k="current_price" className="justify-end">
                  Precio Actual
                </SortHeader>
              </TableHead>
              <TableHead className="text-right">
                <SortHeader sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} k="market_value" className="justify-end">
                  Valor Mercado
                </SortHeader>
              </TableHead>
              <TableHead className="text-right">
                <SortHeader sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} k="pnl_absolute" className="justify-end">
                  G/P $
                </SortHeader>
              </TableHead>
              <TableHead className="text-right">
                <SortHeader sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} k="pnl_percent" className="justify-end">
                  G/P %
                </SortHeader>
              </TableHead>
              <TableHead className="text-right">
                <SortHeader sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} k="daily_change" className="justify-end">
                  Hoy
                </SortHeader>
              </TableHead>
              <TableHead className="text-center">7d</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map(pos => (
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
                <TableCell className="text-right">
                  <FormattedAmount value={pos.avg_cost} from={pos.currency} />
                </TableCell>
                <TableCell className="text-right">
                  <div className="inline-flex items-center gap-1 justify-end">
                    <FormattedAmount value={pos.current_price} from={pos.currency} />
                    {pos.is_stale && (
                      <AlertTriangle className="h-3 w-3 text-yellow-500 shrink-0" />
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-right font-semibold">
                  <FormattedAmount value={pos.market_value} from={pos.currency} />
                </TableCell>
                <TableCell className="text-right">
                  <FormattedAmount value={pos.pnl_absolute} from={pos.currency} colorize showSign className="font-bold" />
                </TableCell>
                <TableCell className="text-right">
                  <PercentageChange value={pos.pnl_percent} className="font-bold" />
                </TableCell>
                <TableCell className="text-right">
                  <PercentageChange value={pos.daily_change_pct} className="text-xs" />
                </TableCell>
                <TableCell className="text-center">
                  <div className="flex justify-center">
                    <Sparkline data={pos.sparkline_7d} width={48} height={16} />
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-2">
        {sorted.map(pos => (
          <div
            key={pos.id}
            className="border border-border rounded-2xl p-3 cursor-pointer hover:bg-muted/50 active:scale-[0.99] transition-all"
            onClick={() => handleRowClick(pos.symbol)}
          >
            <div className="flex justify-between items-start gap-2">
              <div className="min-w-0 flex-shrink">
                <div className="flex items-center gap-1">
                  <p className="font-semibold font-mono text-sm">{pos.symbol}</p>
                  {pos.is_stale && (
                    <AlertTriangle className="h-3 w-3 text-yellow-500 shrink-0" />
                  )}
                </div>
                {pos.name && (
                  <p className="text-xs text-muted-foreground truncate max-w-[140px]">{pos.name}</p>
                )}
                <p className="text-xs text-muted-foreground mt-1">
                  {formatNumber(pos.quantity, 4)} @ <FormattedAmount value={pos.current_price} from={pos.currency} />
                </p>
              </div>
              <div className="flex-shrink-0 py-1">
                <Sparkline data={pos.sparkline_7d} width={48} height={16} />
              </div>
              <div className="text-right flex-shrink-0">
                <p className="font-semibold text-sm">
                  <FormattedAmount value={pos.market_value} from={pos.currency} />
                </p>
                <FormattedAmount value={pos.pnl_absolute} from={pos.currency} colorize showSign className="text-xs font-bold" />
                <p className="text-xs mt-0.5">
                  <PercentageChange value={pos.pnl_percent} className="font-bold" />
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
