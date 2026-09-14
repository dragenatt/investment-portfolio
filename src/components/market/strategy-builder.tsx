'use client'

import { useState } from 'react'
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { getChartTheme, SERIES_PALETTE, LINE_WIDTH } from '@/lib/utils/chart-config'
import { cn } from '@/lib/utils'
import { FlaskConical, Plus, X, Play, AlertTriangle } from 'lucide-react'
import {
  INDICATOR_SPECS,
  OPERATORS,
  EXAMPLE_STRATEGIES,
  describeRule,
  validateStrategy,
  type Strategy,
  type Rule,
  type Condition,
  type Operand,
  type IndicatorId,
  type OperatorId,
} from '@/lib/services/strategy-rule'
import { useStrategyBacktest } from '@/lib/hooks/use-strategy'
import { ChartFigure } from '@/components/charts/chart-figure'
import { formatChartDate, formatChartMoney, seriesTable } from '@/lib/utils/chart-accessibility'

/**
 * Build a trading rule by clicking, then watch it lose to buy-and-hold.
 *
 * That last part is not a joke — it is the point. docs/BACKTEST_RESULTS.md
 * records that this app's own technical signal loses to holding on 9 of 10 real
 * assets, and being shown that on rules you wrote yourself lands very differently
 * from being told it. So the benchmark is never optional, never hidden behind a
 * toggle, and the summary says plainly when nothing beat it.
 */

const emptyCondition = (): Condition => ({
  left: { kind: 'indicator', indicator: 'price' },
  operator: 'gt',
  right: { kind: 'indicator', indicator: 'sma', period: 20 },
})

function OperandEditor({
  operand,
  onChange,
  ariaLabel,
}: {
  operand: Operand
  onChange: (next: Operand) => void
  /** Names the indicator picker for screen readers: which side of which condition. */
  ariaLabel: string
}) {
  const spec =
    operand.kind === 'indicator'
      ? INDICATOR_SPECS.find((s) => s.id === operand.indicator)
      : undefined

  return (
    <div className="flex items-center gap-1.5">
      <Select
        value={operand.kind === 'constant' ? '__constant' : operand.indicator}
        onValueChange={(value) => {
          if (!value) return
          if (value === '__constant') {
            onChange({ kind: 'constant', value: 30 })
            return
          }
          const next = INDICATOR_SPECS.find((s) => s.id === value)!
          onChange({
            kind: 'indicator',
            indicator: value as IndicatorId,
            ...(next.hasPeriod ? { period: next.defaultPeriod } : {}),
          })
        }}
      >
        <SelectTrigger className="h-8 w-auto min-w-36 text-xs" aria-label={ariaLabel}>
          {/* Base UI renders the raw value unless told how to label it. */}
          <SelectValue>
            {(value) =>
              value === '__constant'
                ? 'Un numero fijo'
                : (INDICATOR_SPECS.find((s) => s.id === value)?.label ?? String(value))
            }
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {INDICATOR_SPECS.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              {s.label}
            </SelectItem>
          ))}
          <SelectItem value="__constant">Un numero fijo</SelectItem>
        </SelectContent>
      </Select>

      {operand.kind === 'indicator' && spec?.hasPeriod && (
        <Input
          type="number"
          min={2}
          max={400}
          value={operand.period ?? spec.defaultPeriod}
          onChange={(e) =>
            onChange({ ...operand, period: Math.round(Number(e.target.value)) })
          }
          className="h-8 w-16 text-xs font-mono"
          aria-label={`${ariaLabel}: periodo`}
        />
      )}

      {operand.kind === 'constant' && (
        <Input
          type="number"
          value={operand.value}
          onChange={(e) => onChange({ kind: 'constant', value: Number(e.target.value) })}
          className="h-8 w-20 text-xs font-mono"
          aria-label={`${ariaLabel}: número`}
        />
      )}
    </div>
  )
}

function RuleEditor({
  title,
  rule,
  onChange,
}: {
  title: string
  rule: Rule
  onChange: (next: Rule) => void
}) {
  const update = (index: number, condition: Condition) =>
    onChange({ ...rule, conditions: rule.conditions.map((c, i) => (i === index ? condition : c)) })

  return (
    <div className="rounded-xl border border-border p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-foreground">{title}</span>
        <div className="flex items-center gap-2">
          {rule.conditions.length > 1 && (
            <Select
              value={rule.combinator}
              onValueChange={(v) => v && onChange({ ...rule, combinator: v as 'and' | 'or' })}
            >
              <SelectTrigger className="h-7 w-28 text-[11px]" aria-label={`Cómo combinar las condiciones: ${title}`}>
                <SelectValue>
                  {(value) => (value === 'or' ? 'Cualquiera (O)' : 'Todas (Y)')}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="and">Todas (Y)</SelectItem>
                <SelectItem value="or">Cualquiera (O)</SelectItem>
              </SelectContent>
            </Select>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 gap-1 text-[11px]"
            onClick={() => onChange({ ...rule, conditions: [...rule.conditions, emptyCondition()] })}
          >
            <Plus className="h-3 w-3" /> Condicion
          </Button>
        </div>
      </div>

      {rule.conditions.length === 0 && (
        <p className="text-[11px] text-muted-foreground">
          Sin condiciones. {title.toLowerCase().includes('compra')
            ? 'Sin al menos una, la estrategia nunca entraria al mercado.'
            : 'Sin ninguna, la estrategia compra y no sale nunca, que es comprar y mantener.'}
        </p>
      )}

      {rule.conditions.map((condition, index) => (
        <div key={index} className="flex flex-wrap items-center gap-1.5">
          {index > 0 && (
            <span className="text-[11px] text-muted-foreground w-12 shrink-0">
              {rule.combinator === 'and' ? 'y' : 'o'}
            </span>
          )}
          <OperandEditor
            operand={condition.left}
            onChange={(left) => update(index, { ...condition, left })}
            ariaLabel={`Primer valor de la condición ${index + 1}`}
          />
          <Select
            value={condition.operator}
            onValueChange={(v) => v && update(index, { ...condition, operator: v as OperatorId })}
          >
            <SelectTrigger className="h-8 w-auto min-w-36 text-xs" aria-label={`Comparación de la condición ${index + 1}`}>
              <SelectValue>
                {(value) => OPERATORS.find((o) => o.id === value)?.label ?? String(value)}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {OPERATORS.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <OperandEditor
            operand={condition.right}
            onChange={(right) => update(index, { ...condition, right })}
            ariaLabel={`Segundo valor de la condición ${index + 1}`}
          />
          <button
            type="button"
            onClick={() =>
              onChange({ ...rule, conditions: rule.conditions.filter((_, i) => i !== index) })
            }
            className="text-muted-foreground hover:text-loss p-1"
            aria-label={`Quitar la condición ${index + 1}`}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}

      <p className="text-[11px] text-muted-foreground italic">{describeRule(rule)}</p>
    </div>
  )
}

export function StrategyBuilder({ symbol }: { symbol: string }) {
  const [strategy, setStrategy] = useState<Strategy>(EXAMPLE_STRATEGIES[0].strategy)
  const { data, isRunning, error, run } = useStrategyBacktest(symbol)
  const theme = getChartTheme()

  const validation = validateStrategy(strategy)
  const comparison = data?.comparison
  const own = data?.own

  // One equity curve per strategy would need one colour per strategy, and the
  // scatter cap is three. Only the user's own run is plotted, against its
  // benchmark — the rest of the table carries the comparison numerically.
  const curve = own?.backtest.equityCurve ?? []
  const lastPoint = curve[curve.length - 1]
  const curveSummary = lastPoint
    ? `Capital simulado de tu estrategia frente a comprar y mantener, de ${formatChartDate(curve[0].date)} a ${formatChartDate(
        lastPoint.date,
      )}: tu estrategia termina en ${formatChartMoney(lastPoint.strategy, '')} y comprar y mantener en ${formatChartMoney(lastPoint.buyAndHold, '')}.`
    : ''
  const curveTable = seriesTable(curve, 'Capital simulado por fecha', ['Fecha', 'Tu estrategia', 'Comprar y mantener'], (point) => [
    formatChartDate(point.date),
    formatChartMoney(point.strategy, ''),
    formatChartMoney(point.buyAndHold, ''),
  ])

  return (
    <Card className="rounded-2xl border-border shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <FlaskConical className="h-4 w-4" />
          Laboratorio de estrategias
        </CardTitle>
        <CardDescription className="text-xs">
          Arma una regla sin escribir codigo y pruebala sobre el historial real de {symbol}.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={strategy.name}
            onValueChange={(value) => {
              const example = EXAMPLE_STRATEGIES.find((e) => e.strategy.name === value)
              if (example) setStrategy(example.strategy)
            }}
          >
            <SelectTrigger className="h-9 w-auto min-w-52 text-xs" aria-label="Partir de un ejemplo">
              <SelectValue placeholder="Partir de un ejemplo" />
            </SelectTrigger>
            <SelectContent>
              {EXAMPLE_STRATEGIES.map((e) => (
                <SelectItem key={e.id} value={e.strategy.name}>
                  {e.strategy.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Input
            value={strategy.name}
            onChange={(e) => setStrategy({ ...strategy, name: e.target.value })}
            placeholder="Nombre de tu estrategia"
            className="h-9 w-52 text-xs"
            aria-label="Nombre"
          />

          <Button
            type="button"
            onClick={() => run(strategy, true)}
            disabled={isRunning || !validation.valid}
            className="h-9 gap-1.5 text-xs"
          >
            <Play className="h-3.5 w-3.5" />
            {isRunning ? 'Probando...' : 'Probar'}
          </Button>
        </div>

        <p className="text-[11px] text-muted-foreground">
          {EXAMPLE_STRATEGIES.find((e) => e.strategy.name === strategy.name)?.description}
        </p>

        <div className="grid gap-3 md:grid-cols-2">
          <RuleEditor
            title="Comprar cuando..."
            rule={strategy.buy}
            onChange={(buy) => setStrategy({ ...strategy, buy })}
          />
          <RuleEditor
            title="Vender cuando..."
            rule={strategy.sell}
            onChange={(sell) => setStrategy({ ...strategy, sell })}
          />
        </div>

        {(validation.errors.length > 0 || validation.warnings.length > 0) && (
          <div className="space-y-1">
            {validation.errors.map((message) => (
              <p key={message} className="text-[11px] text-loss flex items-start gap-1.5">
                <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                {message}
              </p>
            ))}
            {validation.warnings.map((message) => (
              <p key={message} className="text-[11px] text-muted-foreground flex items-start gap-1.5">
                <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                {message}
              </p>
            ))}
          </div>
        )}

        {error && <p className="text-[11px] text-loss">{error}</p>}
        {data?.message && <p className="text-[11px] text-muted-foreground">{data.message}</p>}

        {comparison && (
          <div className="space-y-3 border-t border-border pt-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-xs font-medium text-foreground">Resultado</span>
              <span className="text-[11px] text-muted-foreground">
                {data?.bars} barras ({data?.from_date} a {data?.to_date}) · coste{' '}
                {data?.cost_pct}% por lado · ventana comun {comparison.sharedWarmupBars} barras
              </span>
            </div>

            {curve.length > 0 && (
              <ChartFigure summary={curveSummary} table={curveTable}>
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart accessibilityLayer={false} data={curve}>
                    <CartesianGrid {...theme.grid} />
                    <XAxis
                      dataKey="date"
                      {...theme.xAxis}
                      minTickGap={40}
                      tickFormatter={(d: string) => d.slice(5)}
                    />
                    {/* Auto domain: anchoring at zero squashes both curves into a band at
                        the top, where the difference between them is invisible. */}
                    <YAxis
                      {...theme.yAxis}
                      width={56}
                      domain={['auto', 'auto']}
                      tickFormatter={(v: number) => `$${Math.round(v)}`}
                    />
                    <Tooltip
                      cursor={theme.crosshair}
                      contentStyle={{
                        background: 'var(--card)',
                        border: '1px solid var(--border)',
                        borderRadius: 8,
                        fontSize: 11,
                      }}
                      formatter={(v) => (typeof v === 'number' ? `$${v.toFixed(2)}` : String(v))}
                    />
                    <Legend
                      verticalAlign="top"
                      height={24}
                      wrapperStyle={{ fontSize: 11, color: 'var(--muted-foreground)' }}
                    />
                    <Line
                      type="monotone"
                      dataKey="strategy"
                      name="Tu estrategia"
                      stroke={SERIES_PALETTE[0]}
                      strokeWidth={LINE_WIDTH}
                      dot={false}
                      isAnimationActive={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="buyAndHold"
                      name="Comprar y mantener"
                      stroke={SERIES_PALETTE[1]}
                      strokeWidth={LINE_WIDTH}
                      strokeDasharray="4 4"
                      dot={false}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </ChartFigure>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-muted-foreground text-[11px]">
                    <th className="text-left font-normal py-1">Estrategia</th>
                    <th className="text-right font-normal py-1">Rendimiento</th>
                    <th className="text-right font-normal py-1">vs mantener</th>
                    <th className="text-right font-normal py-1">Operaciones</th>
                    <th className="text-right font-normal py-1">Caida max.</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  <tr className="text-muted-foreground">
                    <td className="py-1.5">Comprar y mantener</td>
                    <td className="text-right font-mono">
                      {comparison.buyAndHoldReturnPct.toFixed(1)}%
                    </td>
                    <td className="text-right font-mono">—</td>
                    <td className="text-right font-mono">0</td>
                    <td className="text-right font-mono">—</td>
                  </tr>
                  {comparison.results.map((row) => (
                    <tr key={row.name} className={cn(row.name === strategy.name && 'font-medium')}>
                      <td className="py-1.5">{row.name}</td>
                      <td className="text-right font-mono">
                        {row.backtest.strategy.totalReturnPct.toFixed(1)}%
                      </td>
                      <td
                        className={cn(
                          'text-right font-mono',
                          row.beatBuyAndHold ? 'text-gain' : 'text-loss',
                        )}
                      >
                        {row.versusBuyAndHoldPp >= 0 ? '+' : ''}
                        {row.versusBuyAndHoldPp.toFixed(1)} pp
                      </td>
                      <td className="text-right font-mono">{row.backtest.trades.length}</td>
                      <td className="text-right font-mono">
                        -{row.backtest.strategy.maxDrawdownPct.toFixed(1)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {comparison.skipped.length > 0 && (
              <div className="space-y-1">
                {comparison.skipped.map((s) => (
                  <p key={s.name} className="text-[11px] text-muted-foreground">
                    <span className="text-foreground/80">{s.name}</span> no se pudo probar: {s.reason}
                  </p>
                ))}
              </div>
            )}

            <p className="text-[11px] text-muted-foreground leading-relaxed rounded-xl bg-muted/40 p-3">
              {comparison.summary}
            </p>

            {/* The one thing a green equity curve will not tell anybody. */}
            {data?.caveat && (
              <p className="text-[11px] text-muted-foreground leading-relaxed">{data.caveat}</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
