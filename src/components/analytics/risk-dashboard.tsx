'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatNumber } from '@/lib/utils/numbers'
import { FinanceTooltip } from '@/components/shared/finance-tooltip'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Shield,
  Activity,
  TrendingDown,
  Target,
  AlertTriangle,
  BarChart2,
} from 'lucide-react'
import { type LucideIcon } from 'lucide-react'

type Props = {
  riskScore: number
  sharpeRatio: number
  sortinoRatio: number
  maxDrawdown: number
  maxDrawdownDate: string
  volatility: number
  beta: number
  alpha: number
  calmarRatio: number
  var95: number
  trackingError: number
  informationRatio: number
  isLoading?: boolean
}

// --- Risk Gauge SVG ---

function RiskGauge({ score }: { score: number }) {
  const pct = Math.min(Math.max(score / 10, 0), 1)
  const angle = pct * 180
  const color =
    score <= 3 ? 'var(--good)' : score <= 6 ? '#f59e0b' : 'var(--bad)'
  const radius = 40
  const cx = 50,
    cy = 50
  const startAngle = Math.PI
  const endAngle = startAngle - (angle * Math.PI) / 180
  const x = cx + radius * Math.cos(endAngle)
  const y = cy - radius * Math.sin(endAngle)
  const largeArc = angle > 180 ? 1 : 0

  return (
    <svg viewBox="0 0 100 55" className="w-full max-w-[160px]">
      <path
        d={`M ${cx - radius} ${cy} A ${radius} ${radius} 0 0 1 ${cx + radius} ${cy}`}
        fill="none"
        stroke="var(--muted)"
        strokeWidth="8"
        strokeLinecap="round"
      />
      {angle > 0 && (
        <path
          d={`M ${cx - radius} ${cy} A ${radius} ${radius} 0 ${largeArc} 1 ${x} ${y}`}
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeLinecap="round"
        />
      )}
      <text
        x={cx}
        y={cy - 5}
        textAnchor="middle"
        className="text-2xl font-bold"
        fill="currentColor"
      >
        {score.toFixed(1)}
      </text>
      <text
        x={cx}
        y={cy + 8}
        textAnchor="middle"
        className="text-[8px]"
        fill="var(--muted-foreground)"
      >
        / 10
      </text>
    </svg>
  )
}

// --- Metric Card ---

function MetricCard({
  icon: Icon,
  label,
  value,
  sublabel,
  tooltipTerm,
}: {
  icon: LucideIcon
  label: string
  value: string
  sublabel: string
  tooltipTerm?: string
}) {
  return (
    <div className="text-center p-3 rounded-lg bg-muted/50">
      <div className="flex items-center justify-center gap-1.5 mb-1">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        <p className="text-xs font-medium text-muted-foreground inline-flex items-center gap-1">
          {label}
          {tooltipTerm && <FinanceTooltip term={tooltipTerm} />}
        </p>
      </div>
      <p className="text-2xl font-bold font-mono">{value}</p>
      <p className="text-[11px] text-muted-foreground mt-0.5">{sublabel}</p>
    </div>
  )
}

// --- Secondary Metric ---

function SecondaryMetric({
  label,
  value,
  sublabel,
}: {
  label: string
  value: string
  sublabel: string
}) {
  return (
    <div className="text-center p-2 rounded-lg bg-muted/30">
      <p className="text-lg font-bold font-mono">{value}</p>
      <p className="text-xs font-medium mt-0.5">{label}</p>
      <p className="text-[10px] text-muted-foreground">{sublabel}</p>
    </div>
  )
}

// --- Loading Skeleton ---

function RiskDashboardSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-4 w-40" />
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex justify-center">
          <Skeleton className="h-[55px] w-[160px] rounded-xl" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="p-3 rounded-lg bg-muted/50">
              <Skeleton className="h-3 w-16 mx-auto mb-2" />
              <Skeleton className="h-7 w-20 mx-auto mb-1" />
              <Skeleton className="h-3 w-24 mx-auto" />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="p-2 rounded-lg bg-muted/30">
              <Skeleton className="h-5 w-12 mx-auto mb-1" />
              <Skeleton className="h-3 w-14 mx-auto" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

// --- Main Component ---

export function RiskDashboard({
  riskScore,
  sharpeRatio,
  sortinoRatio,
  maxDrawdown,
  maxDrawdownDate,
  volatility,
  beta,
  alpha,
  calmarRatio,
  var95,
  trackingError,
  informationRatio,
  isLoading,
}: Props) {
  if (isLoading) return <RiskDashboardSkeleton />

  const riskLabel =
    riskScore <= 3 ? 'Bajo' : riskScore <= 6 ? 'Moderado' : 'Alto'

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium inline-flex items-center gap-2">
          <Shield className="h-4 w-4" />
          Panel de Riesgo
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Risk Score Gauge */}
        <div className="flex flex-col items-center gap-1">
          <RiskGauge score={riskScore} />
          <p className="text-xs font-medium text-muted-foreground">
            Riesgo {riskLabel}
          </p>
        </div>

        {/* 2x2 Main Metrics */}
        <div className="grid grid-cols-2 gap-3">
          <MetricCard
            icon={Activity}
            label="Sharpe"
            value={formatNumber(sharpeRatio)}
            sublabel="Rendimiento / riesgo"
            tooltipTerm="Sharpe Ratio"
          />
          <MetricCard
            icon={Target}
            label="Sortino"
            value={formatNumber(sortinoRatio)}
            sublabel="Rendimiento / riesgo a la baja"
          />
          <MetricCard
            icon={TrendingDown}
            label="Max Drawdown"
            value={`${formatNumber(maxDrawdown)}%`}
            sublabel={maxDrawdownDate}
            tooltipTerm="Max Drawdown"
          />
          <MetricCard
            icon={BarChart2}
            label="Volatilidad"
            value={`${formatNumber(volatility)}%`}
            sublabel="Desviacion estandar anualizada"
            tooltipTerm="Volatilidad"
          />
        </div>

        {/* VaR Highlight */}
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
          <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
          <div>
            <p className="text-xs font-medium">VaR 95%</p>
            <p className="text-sm font-mono font-semibold">
              {formatNumber(var95)}%
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Con 95% de confianza, perdida maxima diaria:{' '}
              {formatNumber(Math.abs(var95))}%
            </p>
          </div>
        </div>

        {/* Secondary Metrics Row */}
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
          <SecondaryMetric
            label="Beta"
            value={formatNumber(beta)}
            sublabel="vs mercado"
          />
          <SecondaryMetric
            label="Alpha"
            value={`${formatNumber(alpha)}%`}
            sublabel="exceso de retorno"
          />
          <SecondaryMetric
            label="Calmar"
            value={formatNumber(calmarRatio)}
            sublabel="retorno / drawdown"
          />
          <SecondaryMetric
            label="Tracking Error"
            value={`${formatNumber(trackingError)}%`}
            sublabel="desviacion vs benchmark"
          />
          <SecondaryMetric
            label="Info Ratio"
            value={formatNumber(informationRatio)}
            sublabel="alpha / tracking error"
          />
        </div>
      </CardContent>
    </Card>
  )
}
