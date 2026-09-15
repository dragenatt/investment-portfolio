'use client'

import { useMemo, useState } from 'react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, ReferenceLine, CartesianGrid, Legend } from 'recharts'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartFigure } from '@/components/charts/chart-figure'
import { ChartTooltipContent } from '@/components/charts/chart-tooltip'
import { ChartEmpty, ChartLoading } from '@/components/charts/chart-state'
import { getChartTheme, SERIES_PALETTE } from '@/lib/utils/chart-config'
import { useRiskSources } from '@/lib/hooks/use-analytics'

/**
 * Where the portfolio's risk really comes from (P2-5).
 *
 * The findings answer the question in words first; the views show the same
 * variance split five ways. Every split adds up to the same 100%, which is why
 * they can sit behind one control: the reader is changing the lens, not the
 * number.
 */

type View = 'asset' | 'sector' | 'factor' | 'component' | 'market'

const VIEWS: Array<{ id: View; label: string }> = [
  { id: 'asset', label: 'Activo' },
  { id: 'sector', label: 'Sector' },
  { id: 'factor', label: 'Factor' },
  { id: 'component', label: 'Componente' },
  { id: 'market', label: 'Mercado' },
]

type Row = { label: string; risk: number; other: number | null }

type ViewContent = {
  rows: Row[]
  /** The second bar next to the share of risk, when the view has one. */
  otherLabel: string | null
  columns: string[]
  table: string[][]
} | null

const pct = (value: number) => `${value.toFixed(1)}%`

function SegmentedControl({ value, onChange, available }: { value: View; onChange: (v: View) => void; available: Record<View, boolean> }) {
  return (
    <div role="group" aria-label="Ver el riesgo por" className="flex flex-wrap gap-1">
      {VIEWS.map((view) => (
        <button
          key={view.id}
          type="button"
          aria-pressed={value === view.id}
          disabled={!available[view.id]}
          onClick={() => onChange(view.id)}
          className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
            value === view.id ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {view.label}
        </button>
      ))}
    </div>
  )
}

export function RiskSources({ portfolioId }: { portfolioId: string }) {
  const { data, error, isLoading, mutate } = useRiskSources(portfolioId)
  const [view, setView] = useState<View>('asset')
  const theme = getChartTheme()

  const available: Record<View, boolean> = {
    asset: !!data?.byAsset?.length,
    sector: !!data?.bySector?.length,
    factor: !!data?.byFactor,
    component: !!data?.byComponent,
    market: !!data?.market,
  }

  const content = useMemo<ViewContent>(() => {
    if (!data?.byAsset) return null
    switch (view) {
      case 'sector':
        return {
          rows: (data.bySector ?? []).map((s) => ({ label: s.sector, risk: s.percentOfRisk, other: s.weightPct })),
          otherLabel: 'Peso',
          columns: ['Sector', '% del riesgo', 'Peso', 'Activos'],
          table: (data.bySector ?? []).map((s) => [s.sector, pct(s.percentOfRisk), pct(s.weightPct), s.symbols.join(', ')]),
        }
      case 'factor': {
        const f = data.byFactor
        if (!f) return null
        return {
          rows: [
            ...f.factors.map((x) => ({ label: x.name, risk: x.percentOfRisk, other: null })),
            { label: 'Específico de tus activos', risk: f.specificPct, other: null },
          ],
          otherLabel: null,
          columns: ['Factor', '% del riesgo', 'Exposición', '¿Distinguible del azar?'],
          table: [
            ...f.factors.map((x) => [x.name, pct(x.percentOfRisk), x.exposure.toFixed(2), x.significant ? 'Sí' : 'No']),
            ['Específico de tus activos', pct(f.specificPct), '—', '—'],
          ],
        }
      }
      case 'component': {
        const c = data.byComponent
        if (!c) return null
        return {
          rows: c.components.map((x) => ({ label: `Componente ${x.index}`, risk: x.percentOfRisk, other: x.varianceExplainedPct })),
          otherLabel: 'Variación de los activos',
          columns: ['Componente', '% del riesgo del portafolio', 'Variación de los activos', 'Lo mueven'],
          table: c.components.map((x) => [
            `Componente ${x.index}${x.nearlyTied ? ' (empatado)' : ''}`,
            pct(x.percentOfRisk),
            pct(x.varianceExplainedPct),
            x.loadings.map((l) => `${l.symbol} ${l.loading > 0 ? '+' : '−'}`).join(', ') || '—',
          ]),
        }
      }
      case 'market': {
        const m = data.market
        if (!m) return null
        return {
          rows: [
            { label: `Explicado por ${m.name}`, risk: m.systematicPct, other: null },
            { label: 'No explicado por el mercado', risk: m.specificPct, other: null },
          ],
          otherLabel: null,
          columns: ['Parte', '% del riesgo'],
          table: [
            [`Explicado por ${m.name}`, pct(m.systematicPct)],
            ['No explicado por el mercado', pct(m.specificPct)],
          ],
        }
      }
      default:
        return {
          rows: data.byAsset.map((a) => ({ label: a.symbol, risk: a.percentOfRisk, other: a.weightPct })),
          otherLabel: 'Peso',
          columns: ['Activo', '% del riesgo', 'Peso', 'Volatilidad anual', 'Correlación con la cartera', 'Beta'],
          table: data.byAsset.map((a) => [
            a.symbol,
            pct(a.percentOfRisk),
            pct(a.weightPct),
            pct(a.volatilityPct),
            a.correlationWithPortfolio.toFixed(2),
            a.betaToBenchmark === null ? '—' : a.betaToBenchmark.toFixed(2),
          ]),
        }
    }
  }, [data, view])

  const height = Math.max(160, (content?.rows.length ?? 0) * 36 + 40)
  const viewLabel = VIEWS.find((v) => v.id === view)!.label.toLowerCase()

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="space-y-1.5">
          <CardTitle className="text-sm font-medium">¿De dónde viene el riesgo de tu portafolio?</CardTitle>
          <CardDescription className="text-xs">
            La variación del portafolio repartida por activo, sector, factor, componente principal y mercado. Cada vista
            reparte el mismo riesgo y suma 100%.
          </CardDescription>
        </div>
        {data?.byAsset && <SegmentedControl value={view} onChange={setView} available={available} />}
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading && !data ? (
          <ChartLoading height={220} label="Midiendo las fuentes de riesgo…" />
        ) : error && !data ? (
          <ChartEmpty height={220} kind="error" message="No se pudieron medir las fuentes de riesgo." onRetry={() => mutate()} />
        ) : data?.message || !data?.byAsset || !content ? (
          <ChartEmpty height={220} message={data?.message ?? 'No hay suficiente historial para medir las fuentes de riesgo.'} />
        ) : (
          <>
            {data.findings && data.findings.length > 0 && (
              <ul className="space-y-1.5 text-sm">
                {data.findings.map((finding) => (
                  <li key={finding} className="flex gap-2">
                    <span aria-hidden="true" className="mt-2 h-1 w-1 shrink-0 rounded-full bg-muted-foreground" />
                    <span>{finding}</span>
                  </li>
                ))}
              </ul>
            )}

            <ChartFigure
              summary={`Riesgo por ${viewLabel}: ${content.rows
                .slice(0, 4)
                .map((r) => `${r.label} ${pct(r.risk)}`)
                .join('; ')}.`}
              table={{ caption: `Fuentes de riesgo por ${viewLabel}`, columns: content.columns, rows: content.table }}
            >
              <ResponsiveContainer width="100%" height={height}>
                <BarChart accessibilityLayer={false} data={content.rows} layout="vertical" margin={{ top: 4, right: 16, left: 8 }}>
                  <CartesianGrid {...theme.grid} horizontal={false} vertical />
                  <XAxis type="number" {...theme.xAxis} tickFormatter={(v: number) => `${v}%`} />
                  <YAxis type="category" dataKey="label" {...theme.yAxis} width={150} />
                  <ReferenceLine x={0} stroke={theme.grid.stroke} />
                  <Tooltip
                    cursor={{ fill: 'var(--muted)', fillOpacity: 0.3 }}
                    content={
                      <ChartTooltipContent
                        nameFormatter={(name) => (name === 'risk' ? '% del riesgo' : content.otherLabel ?? name)}
                        valueFormatter={(value) => (typeof value === 'number' ? pct(value) : '—')}
                      />
                    }
                  />
                  {content.otherLabel && (
                    <Legend
                      verticalAlign="top"
                      height={24}
                      formatter={(name: string) => (
                        <span className="text-xs text-muted-foreground">{name === 'risk' ? '% del riesgo' : content.otherLabel}</span>
                      )}
                    />
                  )}
                  <Bar dataKey="risk" fill={SERIES_PALETTE[0]} isAnimationActive={false} barSize={12} />
                  {content.otherLabel && <Bar dataKey="other" fill={SERIES_PALETTE[1]} isAnimationActive={false} barSize={12} />}
                </BarChart>
              </ResponsiveContainer>
            </ChartFigure>

            {view === 'component' && data.byComponent && (
              <p className="text-xs text-muted-foreground">
                Tus posiciones equivalen a{' '}
                <span className="font-financial font-medium text-foreground">{data.byComponent.effectiveBets.toFixed(1)}</span>{' '}
                apuestas independientes. Un componente es una dirección en la que tus activos se mueven juntos; cuando dos
                explican casi lo mismo (empatados), el reparto entre ellos no es único y solo cuenta su suma.
              </p>
            )}
            {view === 'market' && data.market && (
              <p className="text-xs text-muted-foreground">
                Beta{' '}
                <span className="font-financial font-medium text-foreground">{data.market.beta.toFixed(2)}</span>, correlación{' '}
                <span className="font-financial font-medium text-foreground">{data.market.correlation.toFixed(2)}</span> con{' '}
                {data.market.name}. La parte explicada es la correlación al cuadrado.
              </p>
            )}
            {view === 'factor' && data.byFactor && (
              <p className="text-xs text-muted-foreground">
                Factores construidos con ETF como aproximación a los de Fama-French. Una parte negativa significa que ese
                factor compensó a otro en el periodo.
              </p>
            )}
          </>
        )}

        {data?.window && (
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Periodo {data.window.from} a {data.window.to}, {data.window.intervals_used} periodos de {data.window.cadence}, con
            los pesos actuales. Describe cómo se movió el portafolio en ese periodo; no predice el futuro ni es una
            recomendación.
            {data.omitted?.benchmark ? ` ${data.omitted.benchmark}` : ''}
            {data.omitted?.factors ? ` ${data.omitted.factors}` : ''}
            {data.excluded_symbols && data.excluded_symbols.length > 0
              ? ` Sin historial suficiente, fuera del análisis: ${data.excluded_symbols.join(', ')}.`
              : ''}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
