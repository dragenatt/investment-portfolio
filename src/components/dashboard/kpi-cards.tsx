'use client'

import { useState } from 'react'
import { useTranslation } from '@/lib/i18n'
import { Eye, EyeOff, TrendingUp, TrendingDown } from 'lucide-react'
import { FormattedAmount } from '@/components/shared/formatted-amount'
import { PercentageChange } from '@/components/shared/percentage-change'

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

export function KpiCards({ totalValue, totalReturn, totalReturnPct, positionCount, todayReturn, todayReturnPct, totalCost }: Props) {
  const { t } = useTranslation()
  const [balanceVisible, setBalanceVisible] = useState(true)
  const isPositive = totalReturn >= 0
  const hiddenText = '\u2022\u2022\u2022\u2022\u2022\u2022'
  const investedAmount = totalCost != null ? totalCost : totalValue - totalReturn

  return (
    <div className="space-y-1">
      {/* Portfolio value */}
      <div className="flex items-center gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t.dashboard.portfolio_value}
        </p>
        <button
          onClick={() => setBalanceVisible(v => !v)}
          className="text-muted-foreground hover:text-foreground transition-colors"
          aria-label={balanceVisible ? t.dashboard.hide_balance : t.dashboard.show_balance}
        >
          {balanceVisible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
        </button>
      </div>

      <p
        className="font-bold tracking-tight"
        style={{ fontFamily: 'var(--font-serif)', fontSize: 'clamp(28px, 3vw, 40px)', letterSpacing: '-0.03em' }}
      >
        {balanceVisible ? <FormattedAmount value={totalValue} /> : hiddenText}
      </p>

      {/* Return line */}
      <div className="flex items-center gap-1.5">
        {isPositive ? (
          <TrendingUp className="h-3.5 w-3.5" style={{ color: 'var(--good)' }} />
        ) : (
          <TrendingDown className="h-3.5 w-3.5" style={{ color: 'var(--bad)' }} />
        )}
        <span className="text-sm font-medium" style={{ color: isPositive ? 'var(--good)' : 'var(--bad)' }}>
          {balanceVisible ? <FormattedAmount value={totalReturn} showSign /> : hiddenText}
        </span>
        <span className="text-sm font-mono" style={{ color: isPositive ? 'var(--good)' : 'var(--bad)' }}>
          ({balanceVisible ? <PercentageChange value={totalReturnPct} className="text-sm" /> : hiddenText})
        </span>
      </div>

      {/* Inline stats */}
      <div className="flex items-center gap-4 pt-2 text-xs text-muted-foreground">
        <span>Invertido: {balanceVisible ? <FormattedAmount value={investedAmount} className="font-medium text-foreground" /> : hiddenText}</span>
        <span className="text-border">|</span>
        <span>{positionCount} posiciones</span>
        {todayReturn != null && (
          <>
            <span className="text-border">|</span>
            <span>
              Hoy:{' '}
              <span className="font-medium" style={{ color: (todayReturn ?? 0) >= 0 ? 'var(--good)' : 'var(--bad)' }}>
                {balanceVisible ? <><FormattedAmount value={todayReturn} showSign /> (<PercentageChange value={todayReturnPct} className="text-xs" />)</> : hiddenText}
              </span>
            </span>
          </>
        )}
      </div>
    </div>
  )
}
