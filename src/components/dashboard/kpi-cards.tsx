'use client'

import { useState } from 'react'
import { useTranslation } from '@/lib/i18n'
import { Eye, EyeOff, TrendingUp, TrendingDown, Minus, AlertTriangle } from 'lucide-react'
import { FormattedAmount } from '@/components/shared/formatted-amount'
import { PercentageChange } from '@/components/shared/percentage-change'
import { changeTone, toneColor } from '@/lib/utils/change-tone'

type Props = {
  totalValue: number
  totalReturn: number
  totalReturnPct: number
  positionCount: number
  bestPosition?: { symbol: string; changePct: number }
  todayReturn?: number
  todayReturnPct?: number
  totalCost?: number
  /** Currencies the total could not be put into; see usePortfolioStats. */
  unconverted?: string[]
}

export function KpiCards({ totalValue, totalReturn, totalReturnPct, positionCount, todayReturn, todayReturnPct, totalCost, unconverted }: Props) {
  const { t } = useTranslation()
  const [balanceVisible, setBalanceVisible] = useState(true)
  const returnTone = changeTone(totalReturn, 2)
  const todayTone = changeTone(todayReturn, 2)
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
        className="font-bold font-financial"
        style={{ fontSize: 'clamp(28px, 3vw, 40px)' }}
      >
        {balanceVisible ? <FormattedAmount value={totalValue} /> : hiddenText}
      </p>

      {/* Return line */}
      <div className="flex items-center gap-1.5">
        {returnTone === 'gain' ? (
          <TrendingUp aria-hidden="true" className="h-3.5 w-3.5" style={{ color: toneColor(returnTone) }} />
        ) : returnTone === 'loss' ? (
          <TrendingDown aria-hidden="true" className="h-3.5 w-3.5" style={{ color: toneColor(returnTone) }} />
        ) : (
          <Minus aria-hidden="true" className="h-3.5 w-3.5" style={{ color: toneColor(returnTone) }} />
        )}
        <span className="text-sm font-medium" style={{ color: toneColor(returnTone) }}>
          {balanceVisible ? <FormattedAmount value={totalReturn} showSign /> : hiddenText}
        </span>
        <span className="text-sm font-financial" style={{ color: toneColor(returnTone) }}>
          ({balanceVisible ? <PercentageChange value={totalReturnPct} className="text-sm" /> : hiddenText})
        </span>
      </div>

      {/* Inline stats */}
      <div className="flex items-center gap-4 pt-2 text-xs text-muted-foreground">
        <span>Invertido: {balanceVisible ? <FormattedAmount value={investedAmount} className="font-medium text-foreground" /> : hiddenText}</span>
        <span aria-hidden="true" className="text-border">|</span>
        <span>{positionCount} posiciones</span>
        {todayReturn != null && (
          <>
            <span aria-hidden="true" className="text-border">|</span>
            <span>
              Hoy:{' '}
              <span className="font-medium" style={{ color: toneColor(todayTone) }}>
                {balanceVisible ? <><FormattedAmount value={todayReturn} showSign /> (<PercentageChange value={todayReturnPct} className="text-xs" />)</> : hiddenText}
              </span>
            </span>
          </>
        )}
      </div>

      {/* A total that could not be put entirely into one currency says so.
          Without this the figure is indistinguishable from a correct one: the
          amounts that could not be converted are simply added as they came,
          so a position quoted in yen counts as pesos. The chart below has said
          this about its own line since the currency work; the header, which is
          the number people actually read, did not. */}
      {unconverted && unconverted.length > 0 && (
        <p
          className="flex items-start gap-1.5 pt-2 text-xs"
          style={{ color: 'var(--muted-foreground)' }}
          role="status"
        >
          <AlertTriangle aria-hidden="true" className="h-3.5 w-3.5 shrink-0 mt-px" />
          <span>
            No hay tipo de cambio para {unconverted.join(', ')}; esas posiciones
            se suman en su propia moneda, así que el total puede no ser exacto.
          </span>
        </p>
      )}
    </div>
  )
}
