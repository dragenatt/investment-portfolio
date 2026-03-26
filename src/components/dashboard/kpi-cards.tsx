'use client'

import { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Eye, EyeOff, TrendingUp, TrendingDown, Wallet, CircleDollarSign, BarChart3 } from 'lucide-react'
import { FormattedAmount } from '@/components/shared/formatted-amount'
import { PercentageChange } from '@/components/shared/percentage-change'
import { FinanceTooltip } from '@/components/shared/finance-tooltip'

type Props = {
  totalValue: number
  totalReturn: number
  totalReturnPct: number
  positionCount: number
  bestPosition?: { symbol: string; changePct: number }
  todayReturn?: number
  todayReturnPct?: number
  totalCost?: number
}

function isMarketOpen(): boolean {
  const now = new Date()
  const day = now.getDay()
  if (day === 0 || day === 6) return false
  const hours = now.getHours()
  const minutes = now.getMinutes()
  const timeInMinutes = hours * 60 + minutes
  // NYSE hours: 9:30 AM - 4:00 PM ET (approximate — we use local time as a heuristic)
  return timeInMinutes >= 9 * 60 + 30 && timeInMinutes < 16 * 60
}

export function KpiCards({ totalValue, totalReturn, totalReturnPct, positionCount, bestPosition, todayReturn, todayReturnPct, totalCost }: Props) {
  const [balanceVisible, setBalanceVisible] = useState(true)
  const marketOpen = isMarketOpen()
  const isPositive = totalReturn >= 0
  const hiddenText = '\u2022\u2022\u2022\u2022\u2022\u2022'

  const investedAmount = totalCost != null ? totalCost : totalValue - totalReturn

  return (
    <div className="space-y-4">
      {/* Hero section — Robinhood style */}
      <div className="space-y-1">
        <div className="flex items-center gap-3">
          <h2 className="text-sm text-muted-foreground font-medium">Valor del portafolio</h2>
          <button
            onClick={() => setBalanceVisible(v => !v)}
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label={balanceVisible ? 'Ocultar saldo' : 'Mostrar saldo'}
          >
            {balanceVisible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
          </button>
        </div>

        <div className="flex items-baseline gap-3">
          <span className="text-3xl font-bold tracking-tight">
            {balanceVisible ? <FormattedAmount value={totalValue} /> : hiddenText}
          </span>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5">
            {isPositive ? (
              <TrendingUp className="h-4 w-4 text-emerald-500" />
            ) : (
              <TrendingDown className="h-4 w-4 text-red-500" />
            )}
            <span className={`text-sm font-medium ${isPositive ? 'text-emerald-500' : 'text-red-500'}`}>
              {balanceVisible ? <FormattedAmount value={totalReturn} showSign /> : hiddenText}
            </span>
            <span className={`text-sm ${isPositive ? 'text-emerald-500' : 'text-red-500'}`}>
              ({balanceVisible ? <PercentageChange value={totalReturnPct} className="text-sm" /> : hiddenText})
            </span>
          </div>
          <Badge
            variant="outline"
            className={`text-xs gap-1.5 ${marketOpen ? 'border-emerald-500/30' : 'border-muted-foreground/30'}`}
          >
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${marketOpen ? 'bg-emerald-500 animate-pulse' : 'bg-muted-foreground'}`} />
            {marketOpen ? 'Mercado abierto' : 'Mercado cerrado'}
          </Badge>
        </div>
      </div>

      {/* Three metric cards */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="rounded-2xl border-border shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="p-1.5 rounded-lg bg-primary/10">
                <Wallet className="h-3.5 w-3.5 text-primary" />
              </div>
              <span className="text-xs text-muted-foreground font-medium">Valor Invertido</span>
              <FinanceTooltip term="Valor Invertido" />
            </div>
            <p className="text-lg font-bold">
              {balanceVisible ? <FormattedAmount value={investedAmount} /> : hiddenText}
            </p>
            <p className="text-xs text-muted-foreground mt-1">{positionCount} posiciones</p>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-border shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className={`p-1.5 rounded-lg ${todayReturn == null ? 'bg-muted' : (todayReturn ?? 0) >= 0 ? 'bg-emerald-500/10' : 'bg-red-500/10'}`}>
                <CircleDollarSign className={`h-3.5 w-3.5 ${todayReturn == null ? 'text-muted-foreground' : (todayReturn ?? 0) >= 0 ? 'text-emerald-500' : 'text-red-500'}`} />
              </div>
              <span className="text-xs text-muted-foreground font-medium">Ganancia Hoy</span>
              <FinanceTooltip term="Ganancia Hoy" />
            </div>
            <p className="text-lg font-bold">
              {balanceVisible ? <FormattedAmount value={todayReturn} showSign /> : hiddenText}
            </p>
            <p className="text-xs mt-1">
              {balanceVisible ? <PercentageChange value={todayReturnPct} className="text-xs" /> : <span className="text-muted-foreground">{hiddenText}</span>}
            </p>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-border shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className={`p-1.5 rounded-lg ${totalReturn >= 0 ? 'bg-emerald-500/10' : 'bg-red-500/10'}`}>
                <BarChart3 className={`h-3.5 w-3.5 ${totalReturn >= 0 ? 'text-emerald-500' : 'text-red-500'}`} />
              </div>
              <span className="text-xs text-muted-foreground font-medium">Ganancia Total</span>
              <FinanceTooltip term="Ganancia Total" />
            </div>
            <p className="text-lg font-bold">
              {balanceVisible ? <FormattedAmount value={totalReturn} showSign /> : hiddenText}
            </p>
            <p className="text-xs mt-1">
              {balanceVisible ? <PercentageChange value={totalReturnPct} className="text-xs" /> : <span className="text-muted-foreground">{hiddenText}</span>}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
