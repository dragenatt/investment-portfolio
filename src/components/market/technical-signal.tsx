'use client'

import { Activity } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useTranslation } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import type { TechnicalSignal, SignalAction } from '@/lib/services/signal'

const ACTION_STYLES: Record<SignalAction, { text: string; bg: string; dot: string }> = {
  buy: { text: 'text-gain', bg: 'bg-gain/10', dot: 'bg-gain' },
  hold: { text: 'text-amber-500', bg: 'bg-amber-400/10', dot: 'bg-amber-400' },
  sell: { text: 'text-loss', bg: 'bg-loss/10', dot: 'bg-loss' },
}

const SENTIMENT_DOT: Record<'bullish' | 'bearish' | 'neutral', string> = {
  bullish: 'bg-gain',
  bearish: 'bg-loss',
  neutral: 'bg-muted-foreground/40',
}

function fmt(n: number | null, digits = 2): string {
  return n == null ? '--' : n.toFixed(digits)
}

export function TechnicalSignalCard({ signal }: { signal: TechnicalSignal }) {
  const { t } = useTranslation()
  const style = ACTION_STYLES[signal.action]
  const label =
    signal.action === 'buy' ? t.market.buy : signal.action === 'sell' ? t.market.sell : t.market.hold

  // Map score [-100, 100] to a 0..100 marker position on the gauge.
  const markerPct = Math.min(100, Math.max(0, (signal.score + 100) / 2))

  return (
    <Card className="rounded-2xl border-border shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Activity className="h-4 w-4" />
          Señal técnica
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Action + confidence */}
        <div className="flex items-center justify-between">
          <div className={cn('px-3 py-1 rounded-full text-lg font-bold', style.bg, style.text)}>
            {label}
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold font-mono">{signal.confidence}%</p>
            <p className="text-xs text-muted-foreground">confianza</p>
          </div>
        </div>

        {/* Sell → Buy gauge */}
        <div>
          <div className="relative h-2 rounded-full overflow-hidden bg-gradient-to-r from-loss via-amber-400 to-gain">
            <div
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 h-4 w-1.5 rounded-full bg-foreground border border-background"
              style={{ left: `${markerPct}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-muted-foreground mt-1">
            <span>{t.market.sell}</span>
            <span>{t.market.hold}</span>
            <span>{t.market.buy}</span>
          </div>
        </div>

        {/* Metrics */}
        <div className="grid grid-cols-4 gap-2 text-center">
          <Metric label="RSI" value={fmt(signal.metrics.rsi, 0)} />
          <Metric label="SMA20" value={fmt(signal.metrics.sma20)} />
          <Metric label="SMA50" value={fmt(signal.metrics.sma50)} />
          <Metric label="SMA200" value={fmt(signal.metrics.sma200)} />
        </div>

        {/* Reasons */}
        <ul className="space-y-1.5">
          {signal.reasons.map((r, i) => (
            <li key={i} className="flex items-center gap-2 text-sm">
              <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', SENTIMENT_DOT[r.sentiment])} />
              <span className="text-muted-foreground">{r.label}</span>
            </li>
          ))}
        </ul>

        <p className="text-xs text-muted-foreground/70 pt-1 border-t border-border">
          Señal automática basada en análisis técnico (RSI, medias móviles, Bandas de Bollinger).
          Es informativa y no constituye asesoría de inversión.
        </p>
      </CardContent>
    </Card>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-muted/40 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold font-mono">{value}</p>
    </div>
  )
}
