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
    <div className="space-y-5">
      {/* Hero section — editorial style */}
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <h2
            className="text-xs font-extrabold uppercase tracking-widest"
            style={{ color: 'var(--muted)', letterSpacing: '.08em' }}
          >
            Valor del portafolio
          </h2>
          <button
            onClick={() => setBalanceVisible(v => !v)}
            className="transition-colors"
            style={{ color: 'var(--muted)' }}
            aria-label={balanceVisible ? 'Ocultar saldo' : 'Mostrar saldo'}
          >
            {balanceVisible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
          </button>
          <Badge
            variant="outline"
            className="text-xs gap-1.5 ml-auto"
            style={{
              borderColor: marketOpen ? 'color-mix(in srgb, var(--good) 40%, transparent)' : 'color-mix(in srgb, var(--muted) 40%, transparent)',
            }}
          >
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${marketOpen ? 'animate-pulse' : ''}`}
              style={{ backgroundColor: marketOpen ? 'var(--good)' : 'var(--muted)' }}
            />
            {marketOpen ? 'Mercado abierto' : 'Mercado cerrado'}
          </Badge>
        </div>

        <div className="flex items-baseline gap-3">
          <span
            className="font-bold tracking-tight"
            style={{
              fontFamily: 'var(--serif)',
              fontSize: 'clamp(28px, 3.3vw, 44px)',
              letterSpacing: '-0.03em',
            }}
          >
            {balanceVisible ? <FormattedAmount value={totalValue} /> : hiddenText}
          </span>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5">
            {isPositive ? (
              <TrendingUp className="h-4 w-4" style={{ color: 'var(--good)' }} />
            ) : (
              <TrendingDown className="h-4 w-4" style={{ color: 'var(--bad)' }} />
            )}
            <span className="text-sm font-medium" style={{ color: isPositive ? 'var(--good)' : 'var(--bad)' }}>
              {balanceVisible ? <FormattedAmount value={totalReturn} showSign /> : hiddenText}
            </span>
            {/* Delta badge — pill shape */}
            <span
              className="inline-flex items-center font-mono text-xs px-2 py-0.5"
              style={{
                borderRadius: '999px',
                border: `1px solid ${isPositive ? 'var(--good)' : 'var(--bad)'}`,
                backgroundColor: isPositive
                  ? 'color-mix(in srgb, var(--good) 10%, transparent)'
                  : 'color-mix(in srgb, var(--bad) 10%, transparent)',
                color: isPositive ? 'var(--good)' : 'var(--bad)',
                fontSize: '12px',
              }}
            >
              {balanceVisible ? <PercentageChange value={totalReturnPct} className="text-xs" /> : hiddenText}
            </span>
          </div>
        </div>
      </div>

      {/* Three metric cards — glassmorphic with gradient blob */}
      <div className="grid grid-cols-3 gap-3">
        {/* Valor Invertido */}
        <Card
          className="relative overflow-hidden"
          style={{
            borderRadius: '16px',
            border: '1px solid var(--hair)',
            background: 'var(--paper)',
          }}
        >
          {/* Decorative gradient blob */}
          <div
            className="pointer-events-none absolute -top-6 -right-6 h-20 w-20 rounded-full opacity-30 blur-2xl"
            style={{ background: 'var(--brand)' }}
          />
          <CardContent className="p-4 relative z-10">
            <div className="flex items-center gap-2 mb-2">
              <div className="p-1.5 rounded-lg" style={{ backgroundColor: 'color-mix(in srgb, var(--brand) 10%, transparent)' }}>
                <Wallet className="h-3.5 w-3.5" style={{ color: 'var(--brand)' }} />
              </div>
              <span
                className="font-extrabold uppercase"
                style={{ fontSize: '12px', letterSpacing: '.08em', color: 'var(--muted)' }}
              >
                Valor Invertido
              </span>
              <FinanceTooltip term="Valor Invertido" />
            </div>
            <p
              className="font-bold"
              style={{ fontFamily: 'var(--serif)', fontSize: '22px', letterSpacing: '-0.02em' }}
            >
              {balanceVisible ? <FormattedAmount value={investedAmount} /> : hiddenText}
            </p>
            <p style={{ fontSize: '13px', fontWeight: 650, color: 'var(--muted)', marginTop: '4px' }}>
              {positionCount} posiciones
            </p>
          </CardContent>
        </Card>

        {/* Ganancia Hoy */}
        <Card
          className="relative overflow-hidden"
          style={{
            borderRadius: '16px',
            border: '1px solid var(--hair)',
            background: 'var(--paper)',
          }}
        >
          <div
            className="pointer-events-none absolute -top-6 -right-6 h-20 w-20 rounded-full opacity-30 blur-2xl"
            style={{ background: todayReturn == null ? 'var(--muted)' : (todayReturn ?? 0) >= 0 ? 'var(--good)' : 'var(--bad)' }}
          />
          <CardContent className="p-4 relative z-10">
            <div className="flex items-center gap-2 mb-2">
              <div
                className="p-1.5 rounded-lg"
                style={{
                  backgroundColor: todayReturn == null
                    ? 'color-mix(in srgb, var(--muted) 10%, transparent)'
                    : (todayReturn ?? 0) >= 0
                      ? 'color-mix(in srgb, var(--good) 10%, transparent)'
                      : 'color-mix(in srgb, var(--bad) 10%, transparent)',
                }}
              >
                <CircleDollarSign
                  className="h-3.5 w-3.5"
                  style={{
                    color: todayReturn == null ? 'var(--muted)' : (todayReturn ?? 0) >= 0 ? 'var(--good)' : 'var(--bad)',
                  }}
                />
              </div>
              <span
                className="font-extrabold uppercase"
                style={{ fontSize: '12px', letterSpacing: '.08em', color: 'var(--muted)' }}
              >
                Ganancia Hoy
              </span>
              <FinanceTooltip term="Ganancia Hoy" />
            </div>
            <p
              className="font-bold"
              style={{ fontFamily: 'var(--serif)', fontSize: '22px', letterSpacing: '-0.02em' }}
            >
              {balanceVisible ? <FormattedAmount value={todayReturn} showSign /> : hiddenText}
            </p>
            <div style={{ marginTop: '4px' }}>
              {balanceVisible ? (
                <span
                  className="inline-flex items-center font-mono px-2 py-0.5"
                  style={{
                    borderRadius: '999px',
                    fontSize: '12px',
                    border: `1px solid ${(todayReturn ?? 0) >= 0 ? 'var(--good)' : 'var(--bad)'}`,
                    backgroundColor: (todayReturn ?? 0) >= 0
                      ? 'color-mix(in srgb, var(--good) 10%, transparent)'
                      : 'color-mix(in srgb, var(--bad) 10%, transparent)',
                    color: (todayReturn ?? 0) >= 0 ? 'var(--good)' : 'var(--bad)',
                  }}
                >
                  <PercentageChange value={todayReturnPct} className="text-xs" />
                </span>
              ) : (
                <span style={{ color: 'var(--muted)', fontSize: '13px' }}>{hiddenText}</span>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Ganancia Total */}
        <Card
          className="relative overflow-hidden"
          style={{
            borderRadius: '16px',
            border: '1px solid var(--hair)',
            background: 'var(--paper)',
          }}
        >
          <div
            className="pointer-events-none absolute -top-6 -right-6 h-20 w-20 rounded-full opacity-30 blur-2xl"
            style={{ background: totalReturn >= 0 ? 'var(--good)' : 'var(--bad)' }}
          />
          <CardContent className="p-4 relative z-10">
            <div className="flex items-center gap-2 mb-2">
              <div
                className="p-1.5 rounded-lg"
                style={{
                  backgroundColor: totalReturn >= 0
                    ? 'color-mix(in srgb, var(--good) 10%, transparent)'
                    : 'color-mix(in srgb, var(--bad) 10%, transparent)',
                }}
              >
                <BarChart3
                  className="h-3.5 w-3.5"
                  style={{ color: totalReturn >= 0 ? 'var(--good)' : 'var(--bad)' }}
                />
              </div>
              <span
                className="font-extrabold uppercase"
                style={{ fontSize: '12px', letterSpacing: '.08em', color: 'var(--muted)' }}
              >
                Ganancia Total
              </span>
              <FinanceTooltip term="Ganancia Total" />
            </div>
            <p
              className="font-bold"
              style={{ fontFamily: 'var(--serif)', fontSize: '22px', letterSpacing: '-0.02em' }}
            >
              {balanceVisible ? <FormattedAmount value={totalReturn} showSign /> : hiddenText}
            </p>
            <div style={{ marginTop: '4px' }}>
              {balanceVisible ? (
                <span
                  className="inline-flex items-center font-mono px-2 py-0.5"
                  style={{
                    borderRadius: '999px',
                    fontSize: '12px',
                    border: `1px solid ${totalReturn >= 0 ? 'var(--good)' : 'var(--bad)'}`,
                    backgroundColor: totalReturn >= 0
                      ? 'color-mix(in srgb, var(--good) 10%, transparent)'
                      : 'color-mix(in srgb, var(--bad) 10%, transparent)',
                    color: totalReturn >= 0 ? 'var(--good)' : 'var(--bad)',
                  }}
                >
                  <PercentageChange value={totalReturnPct} className="text-xs" />
                </span>
              ) : (
                <span style={{ color: 'var(--muted)', fontSize: '13px' }}>{hiddenText}</span>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
