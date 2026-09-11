'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { FinanceTooltip } from '@/components/shared/finance-tooltip'
import { cn } from '@/lib/utils'
import { Activity, LineChart } from 'lucide-react'
import type { AssetStats } from '@/lib/hooks/use-asset-stats'

/**
 * Performance and risk for one asset.
 *
 * Every value here can be null, and null is rendered as "n/d" rather than as a
 * dash that looks like a number or a zero that looks like a measurement. A
 * five-year column with no five years behind it is the single easiest way for
 * this screen to mislead, so an unreachable window says so.
 */

const NOT_AVAILABLE = 'n/d'

function signClass(value: number | null | undefined): string {
  if (value === null || value === undefined) return 'text-muted-foreground'
  return value >= 0 ? 'text-gain' : 'text-loss'
}

function pct(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return NOT_AVAILABLE
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}%`
}

function num(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return NOT_AVAILABLE
  return value.toFixed(digits)
}

export function AssetPerformance({ stats }: { stats: AssetStats }) {
  const performance = stats.performance ?? []
  if (performance.length === 0) return null

  return (
    <Card className="rounded-2xl border-border shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <LineChart className="h-4 w-4" />
          Rendimiento
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
          {performance.map((horizon) => (
            <div key={horizon.id} className="rounded-lg border border-border p-2">
              <p className="text-[11px] text-muted-foreground">{horizon.label}</p>
              <p className={cn('text-sm font-semibold font-mono', signClass(horizon.returnPct))}>
                {pct(horizon.returnPct, 1)}
              </p>
              {horizon.annualisedPct !== null && horizon.annualisedPct !== undefined && (
                <p className="text-[11px] text-muted-foreground font-mono">
                  {pct(horizon.annualisedPct, 1)} anual
                </p>
              )}
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-muted-foreground">
          Los periodos de mas de un ano muestran tambien la tasa anual compuesta. Una ventana que
          el historial no alcanza aparece como {NOT_AVAILABLE} en vez de medirse desde el primer
          dato disponible, que seria otra cosa.
        </p>
      </CardContent>
    </Card>
  )
}

export function AssetRisk({ stats }: { stats: AssetStats }) {
  const risk = stats.risk
  if (!risk) return null

  const rows: Array<{ label: string; value: string; tooltip?: string; tone?: number | null }> = [
    { label: 'Volatilidad anual', value: pct(risk.volatilityPct, 1), tooltip: 'Volatility' },
    { label: 'Beta', value: num(risk.beta), tooltip: 'Beta' },
    { label: 'Sharpe', value: num(risk.sharpe), tooltip: 'Sharpe Ratio', tone: risk.sharpe },
    { label: 'Sortino', value: num(risk.sortino), tooltip: 'Sortino', tone: risk.sortino },
    { label: 'Caida maxima', value: pct(-risk.maxDrawdownPct, 1), tooltip: 'Max Drawdown' },
    { label: 'VaR 95% (1 dia)', value: pct(risk.var95Pct === null ? null : -risk.var95Pct, 2), tooltip: 'VaR' },
    { label: 'CVaR 95% (1 dia)', value: pct(risk.cvar95Pct === null ? null : -risk.cvar95Pct, 2), tooltip: 'CVaR' },
  ]

  return (
    <Card className="rounded-2xl border-border shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Activity className="h-4 w-4" />
          Riesgo
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="divide-y divide-border">
          {rows.map((row) => (
            <div key={row.label} className="flex items-center justify-between py-2">
              <span className="text-sm text-muted-foreground flex items-center gap-1">
                {row.label}
                {row.tooltip && <FinanceTooltip term={row.tooltip} />}
              </span>
              <span
                className={cn(
                  'text-sm font-semibold font-mono',
                  row.tone !== undefined ? signClass(row.tone) : undefined,
                )}
              >
                {row.value}
              </span>
            </div>
          ))}
        </div>

        <p className="mt-3 text-[11px] text-muted-foreground">
          Calculado sobre {risk.observations} dias de historial
          {stats.from_date && stats.to_date ? ` (${stats.from_date} a ${stats.to_date})` : ''}.
          Beta se mide contra {stats.benchmark_symbol ?? 'el indice'} y queda en {NOT_AVAILABLE}{' '}
          cuando no hay dias en comun suficientes: un 1 por defecto seria afirmar que el activo se
          mueve exactamente con el mercado.
          {stats.risk_free_rate
            ? ` Sharpe y Sortino usan una tasa libre de riesgo de ${stats.risk_free_rate.annual_pct}% (${stats.risk_free_rate.source}).`
            : ''}
        </p>
      </CardContent>
    </Card>
  )
}
