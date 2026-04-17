'use client'

import { useState, useMemo } from 'react'
import { useComparison, useComparisonHistory, useSaveComparison } from '@/lib/hooks/use-compare'
import { usePortfolios } from '@/lib/hooks/use-portfolios'
import { usePublicPortfolios } from '@/lib/hooks/use-discover'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
} from 'recharts'
import { X, Save, Plus, Trophy, Shield, TrendingUp, Target } from 'lucide-react'
import { toast } from 'sonner'
import { PercentageChange } from '@/components/shared/percentage-change'

type Period = '1M' | '3M' | '6M' | '1Y' | '5Y' | 'ALL'

const CHART_COLORS = ['#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4']

export default function ComparePage() {
  const [selectedPortfolios, setSelectedPortfolios] = useState<string[]>([])
  const [period, setPeriod] = useState<Period>('1Y')
  const [searchQuery, setSearchQuery] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [saveDialogOpen, setSaveDialogOpen] = useState(false)
  const [saveName, setSaveName] = useState('')

  const { data: ownPortfolios = [], isLoading: ownLoading } = usePortfolios()
  const { portfolios: publicPortfolios, isLoading: publicLoading } = usePublicPortfolios('recent', 'desc', 'all', 1)

  const { comparison, isLoading: comparisonLoading } = useComparison(selectedPortfolios, period)
  const { history, isLoading: historyLoading } = useComparisonHistory(selectedPortfolios, period)
  const { save: saveComparison, isLoading: savingComparison } = useSaveComparison()

  // Combine own and public portfolios for selection
  const availablePortfolios = useMemo(() => {
    const all = [
      ...(ownPortfolios || []).map((p: { id: string; name: string }) => ({
        id: p.id,
        name: p.name,
        isOwn: true,
      })),
      ...publicPortfolios
        .filter((p) => !ownPortfolios?.some((own: { id: string }) => own.id === p.id))
        .map((p) => ({
          id: p.id,
          name: p.name,
          isOwn: false,
        })),
    ]
    if (!searchQuery) return all
    return all.filter((p) => p.name.toLowerCase().includes(searchQuery.toLowerCase()))
  }, [ownPortfolios, publicPortfolios, searchQuery])

  const handleAddPortfolio = (id: string) => {
    if (!selectedPortfolios.includes(id) && selectedPortfolios.length < 5) {
      setSelectedPortfolios([...selectedPortfolios, id])
      setDialogOpen(false)
    } else if (selectedPortfolios.length >= 5) {
      toast.error('Máximo 5 portafolios')
    }
  }

  const handleRemovePortfolio = (id: string) => {
    setSelectedPortfolios(selectedPortfolios.filter((p) => p !== id))
  }

  const handleSaveComparison = async () => {
    if (!saveName.trim()) {
      toast.error('Campo requerido')
      return
    }
    try {
      await saveComparison(selectedPortfolios, saveName)
      toast.success('Comparación guardada')
      setSaveDialogOpen(false)
      setSaveName('')
    } catch {
      toast.error('Error al guardar')
    }
  }

  // Find best/worst in each metric for highlighting
  const getBestWorst = (metricKey: string, higherIsBetter: boolean) => {
    if (!comparison?.metrics || comparison.metrics.length < 2) return { best: '', worst: '' }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sorted = [...comparison.metrics].sort((a: any, b: any) => {
      const aVal = a[metricKey] ?? -Infinity
      const bVal = b[metricKey] ?? -Infinity
      return higherIsBetter ? bVal - aVal : aVal - bVal
    })
    return { best: sorted[0]?.portfolioId, worst: sorted[sorted.length - 1]?.portfolioId }
  }

  // Prepare chart data for overlaid comparison
  const chartData = useMemo(() => {
    if (!history || history.length === 0) return []

    // Collect all unique dates
    const allDates = new Set<string>()
    history.forEach(h => h.values.forEach(v => allDates.add(v.date)))
    const sortedDates = [...allDates].sort()

    return sortedDates.map(date => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const point: any = { date }
      history.forEach((h, idx) => {
        const entry = h.values.find(v => v.date === date)
        point[`portfolio_${idx}`] = entry?.normalizedValue ?? null
      })
      return point
    })
  }, [history])

  // Radar data for risk profile comparison
  const radarData = useMemo(() => {
    if (!comparison?.metrics) return []

    const metrics = comparison.metrics
    const maxVol = Math.max(...metrics.map(m => m.volatility ?? 0), 0.001)
    const maxDD = Math.max(...metrics.map(m => m.maxDrawdown ?? 0), 0.001)
    const maxSharpe = Math.max(...metrics.map(m => Math.abs(m.sharpeRatio ?? 0)), 0.001)
    const maxDiv = Math.max(...metrics.map(m => m.diversificationScore ?? 0), 0.001)
    const maxWin = Math.max(...metrics.map(m => m.winRate ?? 0), 0.001)

    const dimensions = [
      { label: 'Retorno', key: 'periodReturnPct', max: Math.max(...metrics.map(m => Math.abs(m.periodReturnPct)), 1), higherBetter: true },
      { label: 'Sharpe', key: 'sharpeRatio', max: maxSharpe, higherBetter: true },
      { label: 'Diversificación', key: 'diversificationScore', max: maxDiv, higherBetter: true },
      { label: 'Win Rate', key: 'winRate', max: maxWin, higherBetter: true },
      { label: 'Baja Volatilidad', key: 'volatility', max: maxVol, higherBetter: false },
      { label: 'Bajo Drawdown', key: 'maxDrawdown', max: maxDD, higherBetter: false },
    ]

    return dimensions.map(dim => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const point: any = { metric: dim.label }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      metrics.forEach((m: any, idx: number) => {
        const val = m[dim.key] ?? 0
        // Normalize to 0-100 scale, invert for "lower is better" metrics
        if (dim.higherBetter) {
          point[`portfolio_${idx}`] = dim.max > 0 ? Math.round((Math.abs(val) / dim.max) * 100) : 0
        } else {
          point[`portfolio_${idx}`] = dim.max > 0 ? Math.round((1 - val / dim.max) * 100) : 100
        }
      })
      return point
    })
  }, [comparison])

  const selectedPortfolioNames = selectedPortfolios
    .map((id) => ownPortfolios?.find((p: { id: string }) => p.id === id)?.name || publicPortfolios.find((p) => p.id === id)?.name)
    .filter(Boolean)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-2">
        <h1 className="text-3xl font-bold font-serif">Comparar Portafolios</h1>
        <p className="text-muted-foreground">
          Compara tus portafolios entre sí, o contra portafolios públicos de otros inversores
        </p>
      </div>

      {/* Period Selector */}
      <div className="flex items-center gap-3">
        <Label className="text-sm font-semibold">Período</Label>
        <Select value={period} onValueChange={(v) => setPeriod(v as Period)}>
          <SelectTrigger className="w-[140px] rounded-xl">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="1M">1 Mes</SelectItem>
            <SelectItem value="3M">3 Meses</SelectItem>
            <SelectItem value="6M">6 Meses</SelectItem>
            <SelectItem value="1Y">1 Año</SelectItem>
            <SelectItem value="5Y">5 Años</SelectItem>
            <SelectItem value="ALL">Todo</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Portfolio Selection */}
      <Card className="rounded-xl border-border">
        <CardHeader>
          <CardTitle className="text-lg">Seleccionar Portafolios</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2 flex-wrap">
            {selectedPortfolios.length === 0 ? (
              <p className="text-sm text-muted-foreground">No hay portafolios seleccionados</p>
            ) : (
              selectedPortfolios.map((id, idx) => {
                const ownMatch = ownPortfolios?.find((p: { id: string }) => p.id === id)
                const publicMatch = publicPortfolios.find((p) => p.id === id)
                const name = ownMatch?.name || publicMatch?.name || id
                const isOwn = !!ownMatch
                return (
                  <Badge
                    key={id}
                    variant="secondary"
                    className="px-3 py-1.5 rounded-full flex items-center gap-2 cursor-pointer hover:bg-secondary"
                    style={{ borderLeft: `3px solid ${CHART_COLORS[idx]}` }}
                    onClick={() => handleRemovePortfolio(id)}
                  >
                    {name}
                    <span className="text-[10px] opacity-60">{isOwn ? '(tuyo)' : '(público)'}</span>
                    <X className="h-3 w-3" />
                  </Badge>
                )
              })
            )}
          </div>

          {selectedPortfolios.length < 5 && (
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger>
                <Button variant="outline" className="rounded-xl gap-2">
                  <Plus className="h-4 w-4" />
                  Agregar Portafolio
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md rounded-xl">
                <DialogHeader>
                  <DialogTitle>Agregar Portafolio</DialogTitle>
                </DialogHeader>
                <div className="space-y-3 max-h-[400px] overflow-y-auto">
                  <Input
                    placeholder="Buscar..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="rounded-xl"
                  />
                  {(ownLoading || publicLoading) ? (
                    <div className="space-y-2">
                      {[1, 2, 3].map((i) => (
                        <Skeleton key={i} className="h-10 rounded-lg" />
                      ))}
                    </div>
                  ) : (
                    availablePortfolios.map((p) => (
                      <Button
                        key={p.id}
                        onClick={() => handleAddPortfolio(p.id)}
                        variant="outline"
                        className="w-full justify-start rounded-lg text-left"
                        disabled={selectedPortfolios.includes(p.id)}
                      >
                        <span className="flex-1">{p.name}</span>
                        {p.isOwn ? (
                          <Badge variant="secondary" className="text-xs rounded-full">Tuyo</Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs rounded-full">Público</Badge>
                        )}
                      </Button>
                    ))
                  )}
                </div>
              </DialogContent>
            </Dialog>
          )}
        </CardContent>
      </Card>

      {/* Comparison Data */}
      {selectedPortfolios.length > 0 && (
        <>
          {/* Summary Cards */}
          {comparison?.metrics && comparison.metrics.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
              {comparison.metrics.map((m, idx) => (
                <Card key={m.portfolioId} className="rounded-xl border-border relative overflow-hidden">
                  <div className="absolute top-0 left-0 w-full h-1" style={{ backgroundColor: CHART_COLORS[idx] }} />
                  <CardContent className="p-4 space-y-2">
                    <p className="text-sm font-semibold truncate">{m.portfolioName}</p>
                    <p className="text-2xl font-bold">
                      ${m.currentValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                    <PercentageChange value={m.periodReturnPct} className="text-sm font-bold" />
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{m.positionCount} posiciones</span>
                      {m.riskScore !== null && (
                        <Badge variant={m.riskScore <= 3 ? 'default' : m.riskScore <= 6 ? 'secondary' : 'destructive'} className="text-[10px] px-1.5 py-0 rounded-full">
                          Riesgo {m.riskScore}/10
                        </Badge>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* Performance Chart */}
          <Card className="rounded-xl border-border">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5" />
                Rendimiento Normalizado (Base 100)
              </CardTitle>
              <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
                <DialogTrigger>
                  <Button variant="outline" className="rounded-xl gap-2" disabled={savingComparison}>
                    <Save className="h-4 w-4" />
                    Guardar
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-sm rounded-xl">
                  <DialogHeader>
                    <DialogTitle>Guardar Comparación</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label>Nombre</Label>
                      <Input
                        value={saveName}
                        onChange={(e) => setSaveName(e.target.value)}
                        placeholder="Mi comparación"
                        className="rounded-xl"
                      />
                    </div>
                    <Button
                      onClick={handleSaveComparison}
                      disabled={savingComparison}
                      className="w-full rounded-xl"
                    >
                      {savingComparison ? 'Guardando...' : 'Guardar'}
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </CardHeader>
            <CardContent className="h-[400px]">
              {historyLoading ? (
                <Skeleton className="h-full rounded-lg" />
              ) : chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData}>
                    <defs>
                      {history.map((_, idx) => (
                        <linearGradient key={idx} id={`gradient_${idx}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={CHART_COLORS[idx]} stopOpacity={0.2} />
                          <stop offset="95%" stopColor={CHART_COLORS[idx]} stopOpacity={0} />
                        </linearGradient>
                      ))}
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis
                      dataKey="date"
                      stroke="var(--muted-foreground)"
                      style={{ fontSize: '11px' }}
                      tickFormatter={(d) => new Date(d).toLocaleDateString('es-MX', { month: 'short', day: 'numeric' })}
                    />
                    <YAxis
                      stroke="var(--muted-foreground)"
                      style={{ fontSize: '11px' }}
                      domain={['dataMin - 5', 'dataMax + 5']}
                    />
                    <Tooltip
                      contentStyle={{ borderRadius: '12px', border: '1px solid var(--border)', fontSize: '12px' }}
                      labelFormatter={(d) => new Date(d as string).toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' })}
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      formatter={(value: any, name: any) => {
                        const idx = parseInt(String(name).replace('portfolio_', ''))
                        const label = history[idx]?.portfolioName || name
                        return [typeof value === 'number' ? `${value.toFixed(2)}` : value, label]
                      }}
                    />
                    <Legend
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      formatter={(value: any) => {
                        const idx = parseInt(String(value).replace('portfolio_', ''))
                        return history[idx]?.portfolioName || value
                      }}
                    />
                    {history.map((_, idx) => (
                      <Area
                        key={idx}
                        type="monotone"
                        dataKey={`portfolio_${idx}`}
                        stroke={CHART_COLORS[idx]}
                        fill={`url(#gradient_${idx})`}
                        strokeWidth={2}
                        dot={false}
                        connectNulls
                      />
                    ))}
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-muted-foreground">
                  Sin datos históricos para el período seleccionado
                </div>
              )}
            </CardContent>
          </Card>

          {/* Radar Chart - Risk Profile */}
          {radarData.length > 0 && comparison?.metrics && comparison.metrics.length >= 2 && (
            <Card className="rounded-xl border-border">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Shield className="h-5 w-5" />
                  Perfil de Riesgo Comparativo
                </CardTitle>
              </CardHeader>
              <CardContent className="h-[350px]">
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart data={radarData}>
                    <PolarGrid stroke="var(--border)" />
                    <PolarAngleAxis
                      dataKey="metric"
                      tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
                    />
                    <PolarRadiusAxis
                      angle={30}
                      domain={[0, 100]}
                      tick={{ fontSize: 10 }}
                      stroke="var(--border)"
                    />
                    {history.map((h, idx) => (
                      <Radar
                        key={h.portfolioId}
                        name={h.portfolioName}
                        dataKey={`portfolio_${idx}`}
                        stroke={CHART_COLORS[idx]}
                        fill={CHART_COLORS[idx]}
                        fillOpacity={0.15}
                        strokeWidth={2}
                      />
                    ))}
                    <Legend
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      formatter={(value: any) => {
                        const idx = parseInt(String(value).replace('portfolio_', ''))
                        return history[idx]?.portfolioName || value
                      }}
                    />
                    <Tooltip />
                  </RadarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* Detailed Metrics Table */}
          <Card className="rounded-xl border-border">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Target className="h-5 w-5" />
                Métricas Detalladas
              </CardTitle>
            </CardHeader>
            <CardContent>
              {comparisonLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <Skeleton key={i} className="h-12 rounded-lg" />
                  ))}
                </div>
              ) : comparison?.metrics ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left py-3 px-3 font-semibold">Métrica</th>
                        {comparison.metrics.map((m, idx) => (
                          <th key={m.portfolioId} className="text-right py-3 px-3 font-semibold">
                            <span className="inline-flex items-center gap-1.5">
                              <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: CHART_COLORS[idx] }} />
                              {m.portfolioName}
                            </span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {/* Retorno del período */}
                      <MetricRow
                        label="Retorno del Período"
                        tooltip="Retorno en el período seleccionado"
                        metrics={comparison.metrics}
                        getValue={(m) => m.periodReturnPct}
                        format={(v) => <PercentageChange value={v} className="text-sm font-bold justify-end" />}
                        {...getBestWorst('periodReturnPct', true)}
                      />

                      {/* Retorno Total */}
                      <MetricRow
                        label="Retorno Total"
                        tooltip="Retorno total desde el inicio"
                        metrics={comparison.metrics}
                        getValue={(m) => m.returnPercent}
                        format={(v) => <PercentageChange value={v} className="text-sm font-bold justify-end" />}
                        {...getBestWorst('returnPercent', true)}
                      />

                      {/* Sharpe Ratio */}
                      <MetricRow
                        label="Ratio Sharpe"
                        tooltip="Retorno ajustado por riesgo. Más alto = mejor"
                        metrics={comparison.metrics}
                        getValue={(m) => m.sharpeRatio}
                        format={(v) => <span className={`font-medium ${v !== null && v > 1 ? 'text-emerald-500' : v !== null && v < 0 ? 'text-red-500' : ''}`}>{v !== null ? v.toFixed(2) : '—'}</span>}
                        {...getBestWorst('sharpeRatio', true)}
                      />

                      {/* Sortino Ratio */}
                      <MetricRow
                        label="Ratio Sortino"
                        tooltip="Similar al Sharpe pero solo penaliza caídas. Más alto = mejor"
                        metrics={comparison.metrics}
                        getValue={(m) => m.sortinoRatio}
                        format={(v) => <span className="font-medium">{v !== null ? v.toFixed(2) : '—'}</span>}
                        {...getBestWorst('sortinoRatio', true)}
                      />

                      {/* Volatility */}
                      <MetricRow
                        label="Volatilidad (diaria)"
                        tooltip="Desviación estándar de retornos diarios. Menor = más estable"
                        metrics={comparison.metrics}
                        getValue={(m) => m.volatility}
                        format={(v) => <span className="font-medium">{v !== null ? `${(v * 100).toFixed(2)}%` : '—'}</span>}
                        {...getBestWorst('volatility', false)}
                      />

                      {/* Max Drawdown */}
                      <MetricRow
                        label="Máx Drawdown"
                        tooltip="Mayor caída desde un pico. Menor = mejor"
                        metrics={comparison.metrics}
                        getValue={(m) => m.maxDrawdown}
                        format={(v) => <span className="font-medium text-red-500">{v !== null ? `${(v * 100).toFixed(2)}%` : '—'}</span>}
                        {...getBestWorst('maxDrawdown', false)}
                      />

                      {/* Beta */}
                      <MetricRow
                        label="Beta"
                        tooltip="Sensibilidad vs mercado. 1.0 = igual al mercado"
                        metrics={comparison.metrics}
                        getValue={(m) => m.beta}
                        format={(v) => <span className="font-medium">{v !== null ? v.toFixed(2) : '—'}</span>}
                        {...getBestWorst('beta', false)}
                      />

                      {/* Alpha */}
                      <MetricRow
                        label="Alpha"
                        tooltip="Exceso de retorno vs mercado. Positivo = supera al mercado"
                        metrics={comparison.metrics}
                        getValue={(m) => m.alpha}
                        format={(v) => <span className={`font-medium ${v !== null && v > 0 ? 'text-emerald-500' : v !== null && v < 0 ? 'text-red-500' : ''}`}>{v !== null ? `${(v * 100).toFixed(2)}%` : '—'}</span>}
                        {...getBestWorst('alpha', true)}
                      />

                      {/* Win Rate */}
                      <MetricRow
                        label="Tasa de Ganancia"
                        tooltip="% de días con retorno positivo"
                        metrics={comparison.metrics}
                        getValue={(m) => m.winRate}
                        format={(v) => <span className="font-medium">{v !== null ? `${(v * 100).toFixed(1)}%` : '—'}</span>}
                        {...getBestWorst('winRate', true)}
                      />

                      {/* Diversification */}
                      <MetricRow
                        label="Diversificación"
                        tooltip="Score basado en HHI. 0 = concentrado, 1 = diversificado"
                        metrics={comparison.metrics}
                        getValue={(m) => m.diversificationScore}
                        format={(v) => <span className="font-medium">{v !== null ? v.toFixed(2) : '—'}</span>}
                        {...getBestWorst('diversificationScore', true)}
                      />

                      {/* Risk Score */}
                      <MetricRow
                        label="Score de Riesgo"
                        tooltip="Riesgo compuesto de 1 (bajo) a 10 (alto)"
                        metrics={comparison.metrics}
                        getValue={(m) => m.riskScore}
                        format={(v) => {
                          if (v === null) return <span className="font-medium">—</span>
                          const color = v <= 3 ? 'text-emerald-500' : v <= 6 ? 'text-yellow-500' : 'text-red-500'
                          return <span className={`font-bold ${color}`}>{v}/10</span>
                        }}
                        {...getBestWorst('riskScore', false)}
                      />
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-muted-foreground">Sin datos</p>
              )}
            </CardContent>
          </Card>

          {/* Top Holdings Comparison */}
          {comparison?.metrics && comparison.metrics.some(m => m.topHoldings.length > 0) && (
            <Card className="rounded-xl border-border">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Trophy className="h-5 w-5" />
                  Top Holdings
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {comparison.metrics.map((m, idx) => (
                    <div key={m.portfolioId} className="space-y-2">
                      <p className="text-sm font-semibold flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: CHART_COLORS[idx] }} />
                        {m.portfolioName}
                      </p>
                      <div className="space-y-1">
                        {m.topHoldings.slice(0, 5).map((h) => (
                          <div key={h.symbol} className="flex justify-between text-xs">
                            <span className="font-medium">{h.symbol}</span>
                            <span className="text-muted-foreground">{h.weight.toFixed(1)}%</span>
                          </div>
                        ))}
                        {m.topHoldings.length === 0 && (
                          <p className="text-xs text-muted-foreground">Sin posiciones</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {selectedPortfolios.length === 0 && (
        <Card className="rounded-xl border-border">
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground mb-4">
              Selecciona al menos 2 portafolios para empezar a comparar
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// ─── Metric Row Component ───────────────────────────────────────────────────

type ComparisonMetric = {
  portfolioId: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any
}

function MetricRow({
  label,
  tooltip,
  metrics,
  getValue,
  format,
  best,
  worst,
}: {
  label: string
  tooltip?: string
  metrics: ComparisonMetric[]
  getValue: (m: ComparisonMetric) => number | null
  format: (v: number | null) => React.ReactNode
  best: string
  worst: string
}) {
  return (
    <tr className="border-b border-border hover:bg-secondary/50 transition-colors">
      <td className="py-3 px-3" title={tooltip}>
        <span className="cursor-help">{label}</span>
      </td>
      {metrics.map((m) => {
        const value = getValue(m)
        const isBest = m.portfolioId === best && metrics.length > 1
        const isWorst = m.portfolioId === worst && metrics.length > 1
        return (
          <td key={m.portfolioId} className="text-right py-3 px-3 relative">
            <div className="flex items-center justify-end gap-1.5">
              {format(value)}
              {isBest && <Trophy className="h-3.5 w-3.5 text-yellow-500 shrink-0" />}
            </div>
          </td>
        )
      })}
    </tr>
  )
}
