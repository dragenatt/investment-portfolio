'use client'

import { useState, useMemo, useCallback, useEffect, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import useSWR from 'swr'
import { apiFetcher } from '@/lib/api/fetcher'
import { useMarketSearch, useQuote } from '@/lib/hooks/use-market'
import { useTranslation } from '@/lib/i18n'
import { getChartTheme } from '@/lib/utils/chart-config'
import { formatPercent } from '@/lib/utils/numbers'
import { cn } from '@/lib/utils'
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Search,
  X,
  AlertCircle,
  ArrowUpDown,
  ArrowLeft,
  Loader2,
} from 'lucide-react'
import Link from 'next/link'

// ─── Constants ───────────────────────────────────────────────────────
const MAX_SYMBOLS = 5

const COLORS = ['#2563eb', '#dc2626', '#16a34a', '#f59e0b', '#8b5cf6']

const RANGE_OPTIONS = [
  { label: '1M', value: '1mo' },
  { label: '3M', value: '3mo' },
  { label: '6M', value: '6mo' },
  { label: '1A', value: '1y' },
  { label: '5A', value: 'max' },
]

type HistoryPoint = { date: string; close: number }

type SortColumn =
  | 'symbol'
  | 'price'
  | 'changePct'
  | 'change1M'
  | 'change1Y'
  | 'marketCap'
type SortDir = 'asc' | 'desc'

// ─── Helper: format large numbers ────────────────────────────────────
function formatLargeNumber(n: number | null | undefined): string {
  if (n == null) return '--'
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  return `$${n.toLocaleString()}`
}

// ─── Helper: format date for range ───────────────────────────────────
function formatDateForRange(dateStr: string, range: string): string {
  const date = new Date(dateStr)
  if (range === '1mo') {
    return date.toLocaleDateString('es-MX', { month: 'short', day: 'numeric' })
  }
  if (range === '3mo') {
    return date.toLocaleDateString('es-MX', { month: 'short', day: 'numeric' })
  }
  return date.toLocaleDateString('es-MX', { month: 'short', year: '2-digit' })
}

// ─── Hook: fetch history for one symbol ──────────────────────────────
function useHistory(symbol: string | null, range: string) {
  return useSWR<HistoryPoint[]>(
    symbol
      ? `/api/market/${encodeURIComponent(symbol)}/history?range=${range}`
      : null,
    apiFetcher
  )
}

// ─── Normalize data to percentage from first point ───────────────────
function normalizeHistory(data: HistoryPoint[]): Array<{ date: string; value: number }> {
  if (!data || data.length === 0) return []
  const firstPrice = data[0].close
  if (firstPrice === 0) return []
  return data.map((d) => ({
    date: d.date,
    value: ((d.close - firstPrice) / firstPrice) * 100,
  }))
}

// ─── Per-symbol data fetcher component ───────────────────────────────
function SymbolDataFetcher({
  symbol,
  range,
  onData,
  onError,
}: {
  symbol: string
  range: string
  onData: (symbol: string, data: HistoryPoint[]) => void
  onError: (symbol: string, err: string) => void
}) {
  const { data, error } = useHistory(symbol, range)

  useEffect(() => {
    if (data) onData(symbol, data)
  }, [data, symbol, onData])

  useEffect(() => {
    if (error) onError(symbol, error.message || 'Error al cargar datos')
  }, [error, symbol, onError])

  return null
}

// ─── Quote data fetcher ──────────────────────────────────────────────
function QuoteDataFetcher({
  symbol,
  onData,
}: {
  symbol: string
  onData: (symbol: string, quote: Record<string, unknown>) => void
}) {
  const { data } = useQuote(symbol)

  useEffect(() => {
    if (data) onData(symbol, data)
  }, [data, symbol, onData])

  return null
}

// ─── Custom Tooltip ──────────────────────────────────────────────────
function CompareTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: Array<{ dataKey: string; value: number; color: string }>
  label?: string
}) {
  if (!active || !payload || payload.length === 0) return null
  return (
    <div className="bg-popover border border-border rounded-lg px-3 py-2 shadow-lg">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      {payload.map((entry) => (
        <div key={entry.dataKey} className="flex items-center gap-2 text-sm">
          <span
            className="inline-block w-2.5 h-2.5 rounded-full"
            style={{ backgroundColor: entry.color }}
          />
          <span className="font-medium">{entry.dataKey}</span>
          <span className="font-mono ml-auto">
            {entry.value >= 0 ? '+' : ''}
            {entry.value.toFixed(2)}%
          </span>
        </div>
      ))}
    </div>
  )
}

// ─── Search Results Dropdown ─────────────────────────────────────────
function SearchDropdown({
  query,
  onSelect,
  existingSymbols,
}: {
  query: string
  onSelect: (symbol: string) => void
  existingSymbols: string[]
}) {
  const { data: results, isLoading } = useMarketSearch(query)
  const { t } = useTranslation()

  if (!query || query.length < 2) return null
  if (isLoading) {
    return (
      <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-popover border border-border rounded-xl shadow-lg p-3">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">{t.market.searching}</span>
        </div>
      </div>
    )
  }

  if (!results || results.length === 0) {
    return (
      <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-popover border border-border rounded-xl shadow-lg p-3">
        <p className="text-sm text-muted-foreground text-center">{t.market.no_results}</p>
      </div>
    )
  }

  return (
    <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-popover border border-border rounded-xl shadow-lg overflow-hidden max-h-60 overflow-y-auto">
      {results.map((r: { symbol: string; name: string; type: string }) => {
        const alreadyAdded = existingSymbols.includes(r.symbol)
        return (
          <button
            key={r.symbol}
            disabled={alreadyAdded}
            onClick={() => onSelect(r.symbol)}
            className={cn(
              'w-full text-left px-4 py-2.5 flex items-center justify-between hover:bg-muted transition-colors',
              alreadyAdded && 'opacity-50 cursor-not-allowed'
            )}
          >
            <div>
              <span className="font-mono font-medium text-sm">{r.symbol}</span>
              <p className="text-xs text-muted-foreground truncate max-w-[250px]">
                {r.name}
              </p>
            </div>
            {alreadyAdded && (
              <span className="text-xs text-muted-foreground">{t.watchlist.already_added}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}

// ─── Inner component that uses useSearchParams ───────────────────────
function ComparePageInner() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const { t } = useTranslation()

  // Initialize from URL
  const initialSymbols = useMemo(() => {
    const param = searchParams.get('symbols')
    if (!param) return []
    return param
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean)
      .slice(0, MAX_SYMBOLS)
  }, [searchParams])

  const [symbols, setSymbols] = useState<string[]>(initialSymbols)
  const [range, setRange] = useState('1mo')
  const [query, setQuery] = useState('')
  const [showSearch, setShowSearch] = useState(false)

  // Collected data from fetcher children
  const [historyData, setHistoryData] = useState<
    Record<string, HistoryPoint[]>
  >({})
  const [historyErrors, setHistoryErrors] = useState<Record<string, string>>({})
  const [quoteData, setQuoteData] = useState<
    Record<string, Record<string, unknown>>
  >({})

  // Sort state for table
  const [sortCol, setSortCol] = useState<SortColumn>('symbol')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  const theme = getChartTheme()

  // ─── Callbacks ───────────────────────────────────────────────────
  const handleHistoryData = useCallback(
    (sym: string, data: HistoryPoint[]) => {
      setHistoryData((prev) => ({ ...prev, [sym]: data }))
      setHistoryErrors((prev) => {
        if (!prev[sym]) return prev
        const next = { ...prev }
        delete next[sym]
        return next
      })
    },
    []
  )

  const handleHistoryError = useCallback((sym: string, err: string) => {
    setHistoryErrors((prev) => ({ ...prev, [sym]: err }))
  }, [])

  const handleQuoteData = useCallback(
    (sym: string, quote: Record<string, unknown>) => {
      setQuoteData((prev) => ({ ...prev, [sym]: quote }))
    },
    []
  )

  const addSymbol = useCallback(
    (sym: string) => {
      const upper = sym.toUpperCase()
      if (symbols.includes(upper) || symbols.length >= MAX_SYMBOLS) return
      const next = [...symbols, upper]
      setSymbols(next)
      setQuery('')
      setShowSearch(false)
      // Update URL
      router.replace(`/market/compare?symbols=${next.join(',')}`, {
        scroll: false,
      })
    },
    [symbols, router]
  )

  const removeSymbol = useCallback(
    (sym: string) => {
      const next = symbols.filter((s) => s !== sym)
      setSymbols(next)
      // Clean up data
      setHistoryData((prev) => {
        const n = { ...prev }
        delete n[sym]
        return n
      })
      setQuoteData((prev) => {
        const n = { ...prev }
        delete n[sym]
        return n
      })
      setHistoryErrors((prev) => {
        const n = { ...prev }
        delete n[sym]
        return n
      })
      router.replace(
        next.length > 0
          ? `/market/compare?symbols=${next.join(',')}`
          : '/market/compare',
        { scroll: false }
      )
    },
    [symbols, router]
  )

  // ─── Build chart data ────────────────────────────────────────────
  const chartData = useMemo(() => {
    const normalizedBySymbol: Record<
      string,
      Array<{ date: string; value: number }>
    > = {}
    for (const sym of symbols) {
      if (historyData[sym]) {
        normalizedBySymbol[sym] = normalizeHistory(historyData[sym])
      }
    }

    // Find the symbol with the most data points to use as date axis
    let longestSym = ''
    let longestLen = 0
    for (const sym of symbols) {
      const len = normalizedBySymbol[sym]?.length ?? 0
      if (len > longestLen) {
        longestLen = len
        longestSym = sym
      }
    }

    if (!longestSym || longestLen === 0) return []

    // Build merged data indexed by date
    const dateMap = new Map<string, Record<string, number>>()
    for (const sym of symbols) {
      const normalized = normalizedBySymbol[sym]
      if (!normalized) continue
      for (const point of normalized) {
        if (!dateMap.has(point.date)) {
          dateMap.set(point.date, {})
        }
        dateMap.get(point.date)![sym] = point.value
      }
    }

    // Sort by date and format
    const sorted = Array.from(dateMap.entries()).sort(
      (a, b) => new Date(a[0]).getTime() - new Date(b[0]).getTime()
    )

    return sorted.map(([date, values]) => ({
      date: formatDateForRange(date, range),
      rawDate: date,
      ...values,
    }))
  }, [symbols, historyData, range])

  // ─── Chart legend data ───────────────────────────────────────────
  const legendData = useMemo(() => {
    return symbols.map((sym, i) => {
      const normalized = historyData[sym]
        ? normalizeHistory(historyData[sym])
        : []
      const lastValue = normalized.length > 0 ? normalized[normalized.length - 1].value : null
      const hasError = !!historyErrors[sym]
      return {
        symbol: sym,
        color: COLORS[i % COLORS.length],
        changePct: lastValue,
        hasError,
        errorMsg: historyErrors[sym],
      }
    })
  }, [symbols, historyData, historyErrors])

  // ─── Table data with sorting ─────────────────────────────────────
  const tableData = useMemo(() => {
    const rows = symbols.map((sym, i) => {
      const quote = quoteData[sym] as
        | {
            price?: number
            changePct?: number
            change?: number
            marketCap?: number
            currency?: string
          }
        | undefined
      const history = historyData[sym]
      const normalized = history ? normalizeHistory(history) : []
      const lastPct =
        normalized.length > 0
          ? normalized[normalized.length - 1].value
          : null

      // Approximate 1M and 1Y changes from available data
      // For the current range data, the lastPct IS the range change
      // We'll use quote data for current price/change and history for period changes

      return {
        symbol: sym,
        color: COLORS[i % COLORS.length],
        price: (quote?.price as number) ?? null,
        changePct: (quote?.changePct as number) ?? null,
        change1M: lastPct, // This is the range change
        change1Y: null as number | null, // We don't have 1Y data unless range is 1y
        marketCap: (quote?.marketCap as number) ?? null,
        hasError: !!historyErrors[sym],
        currency: (quote?.currency as string) ?? 'USD',
      }
    })

    // Sort
    rows.sort((a, b) => {
      let aVal: number | string | null = null
      let bVal: number | string | null = null

      switch (sortCol) {
        case 'symbol':
          aVal = a.symbol
          bVal = b.symbol
          break
        case 'price':
          aVal = a.price
          bVal = b.price
          break
        case 'changePct':
          aVal = a.changePct
          bVal = b.changePct
          break
        case 'change1M':
          aVal = a.change1M
          bVal = b.change1M
          break
        case 'change1Y':
          aVal = a.change1Y
          bVal = b.change1Y
          break
        case 'marketCap':
          aVal = a.marketCap
          bVal = b.marketCap
          break
      }

      if (aVal == null && bVal == null) return 0
      if (aVal == null) return 1
      if (bVal == null) return -1

      const cmp =
        typeof aVal === 'string'
          ? aVal.localeCompare(bVal as string)
          : (aVal as number) - (bVal as number)
      return sortDir === 'asc' ? cmp : -cmp
    })

    return rows
  }, [symbols, quoteData, historyData, historyErrors, sortCol, sortDir])

  const toggleSort = (col: SortColumn) => {
    if (sortCol === col) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortCol(col)
      setSortDir('asc')
    }
  }

  const isLoading = symbols.some(
    (sym) => !historyData[sym] && !historyErrors[sym]
  )

  // Determine the label for current range
  const currentRangeLabel =
    RANGE_OPTIONS.find((r) => r.value === range)?.label ?? '1M'

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* ─── Data fetchers (invisible) ──────────────────────────────── */}
      {symbols.map((sym) => (
        <SymbolDataFetcher
          key={`${sym}-${range}`}
          symbol={sym}
          range={range}
          onData={handleHistoryData}
          onError={handleHistoryError}
        />
      ))}
      {symbols.map((sym) => (
        <QuoteDataFetcher
          key={`quote-${sym}`}
          symbol={sym}
          onData={handleQuoteData}
        />
      ))}

      {/* ─── Header ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <Link href="/market">
          <Button variant="ghost" size="icon" className="rounded-xl">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <h1 className="text-2xl font-bold">{t.market.compare_assets}</h1>
      </div>

      {/* ─── Symbol Selector ────────────────────────────────────────── */}
      <Card className="rounded-2xl">
        <CardContent className="p-4 space-y-3">
          {/* Added symbols as pills */}
          <div className="flex flex-wrap gap-2">
            {symbols.map((sym, i) => (
              <span
                key={sym}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium text-white"
                style={{ backgroundColor: COLORS[i % COLORS.length] }}
              >
                {sym}
                <button
                  onClick={() => removeSymbol(sym)}
                  className="hover:bg-white/20 rounded-full p-0.5 transition-colors"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            {symbols.length === 0 && (
              <p className="text-sm text-muted-foreground">
                {t.market.add_symbols}
              </p>
            )}
          </div>

          {/* Search input */}
          {symbols.length < MAX_SYMBOLS && (
            <div className="relative max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-10 h-10 rounded-xl"
                placeholder={t.market.search_symbol}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setShowSearch(true)
                }}
                onFocus={() => setShowSearch(true)}
                onBlur={() => {
                  // Delay to allow click on dropdown
                  setTimeout(() => setShowSearch(false), 200)
                }}
              />
              {showSearch && (
                <SearchDropdown
                  query={query}
                  onSelect={addSymbol}
                  existingSymbols={symbols}
                />
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── Chart ──────────────────────────────────────────────────── */}
      {symbols.length > 0 && (
        <Card className="rounded-2xl">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              {t.market.comparative_performance}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Error indicators */}
            {legendData
              .filter((l) => l.hasError)
              .map((l) => (
                <div
                  key={l.symbol}
                  className="flex items-center gap-2 text-sm text-muted-foreground"
                >
                  <AlertCircle className="h-4 w-4 text-destructive" />
                  <span>
                    {l.symbol}: {l.errorMsg}
                  </span>
                </div>
              ))}

            {/* Legend */}
            <div className="flex flex-wrap gap-4">
              {legendData.map((l) => (
                <div
                  key={l.symbol}
                  className={cn(
                    'flex items-center gap-2 text-sm',
                    l.hasError && 'opacity-40'
                  )}
                >
                  <span
                    className="inline-block w-3 h-3 rounded-full"
                    style={{ backgroundColor: l.color }}
                  />
                  <span className="font-medium">{l.symbol}</span>
                  {l.changePct != null && (
                    <span
                      className={cn(
                        'font-mono text-xs',
                        l.changePct >= 0 ? 'text-gain' : 'text-loss'
                      )}
                    >
                      {formatPercent(l.changePct)}
                    </span>
                  )}
                </div>
              ))}
            </div>

            {/* Chart area */}
            {isLoading ? (
              <div className="flex items-center justify-center h-[300px]">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : chartData.length > 0 ? (
              <div className="w-full" style={{ height: 300 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <XAxis
                      dataKey="date"
                      {...theme.xAxis}
                      interval="preserveStartEnd"
                      minTickGap={40}
                    />
                    <YAxis
                      {...theme.yAxis}
                      domain={['auto', 'auto']}
                      tickFormatter={(v: number) => `${v.toFixed(0)}%`}
                    />
                    <Tooltip
                      content={<CompareTooltip />}
                      cursor={{
                        stroke: 'hsl(var(--muted-foreground))',
                        strokeWidth: 1,
                        strokeDasharray: '4 4',
                      }}
                    />
                    {symbols.map((sym, i) => (
                      <Line
                        key={sym}
                        type="monotone"
                        dataKey={sym}
                        stroke={COLORS[i % COLORS.length]}
                        strokeWidth={2}
                        dot={false}
                        activeDot={{
                          r: 4,
                          fill: COLORS[i % COLORS.length],
                          stroke: 'hsl(var(--background))',
                          strokeWidth: 2,
                        }}
                        connectNulls
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="flex items-center justify-center h-[300px] text-muted-foreground text-sm">
                {t.market.no_data_display}
              </div>
            )}

            {/* Timeframe pills */}
            <div className="flex items-center justify-center gap-1">
              {RANGE_OPTIONS.map((r) => (
                <button
                  key={r.value}
                  onClick={() => {
                    setRange(r.value)
                    // Clear history data so it refetches
                    setHistoryData({})
                    setHistoryErrors({})
                  }}
                  className={cn(
                    'px-3 py-1.5 rounded-full text-xs font-medium transition-colors',
                    r.value === range
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:bg-muted'
                  )}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ─── Comparison Table ───────────────────────────────────────── */}
      {symbols.length > 0 && (
        <Card className="rounded-2xl">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              {t.market.comparison_table}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <button
                      onClick={() => toggleSort('symbol')}
                      className="flex items-center gap-1 hover:text-foreground transition-colors"
                    >
                      {t.portfolio.symbol}
                      <ArrowUpDown className="h-3 w-3" />
                    </button>
                  </TableHead>
                  <TableHead>
                    <button
                      onClick={() => toggleSort('price')}
                      className="flex items-center gap-1 hover:text-foreground transition-colors"
                    >
                      {t.portfolio.price}
                      <ArrowUpDown className="h-3 w-3" />
                    </button>
                  </TableHead>
                  <TableHead>
                    <button
                      onClick={() => toggleSort('changePct')}
                      className="flex items-center gap-1 hover:text-foreground transition-colors"
                    >
                      {t.market.change_pct}
                      <ArrowUpDown className="h-3 w-3" />
                    </button>
                  </TableHead>
                  <TableHead>
                    <button
                      onClick={() => toggleSort('change1M')}
                      className="flex items-center gap-1 hover:text-foreground transition-colors"
                    >
                      Cambio {currentRangeLabel}
                      <ArrowUpDown className="h-3 w-3" />
                    </button>
                  </TableHead>
                  <TableHead>
                    <button
                      onClick={() => toggleSort('marketCap')}
                      className="flex items-center gap-1 hover:text-foreground transition-colors"
                    >
                      {t.market.market_cap}
                      <ArrowUpDown className="h-3 w-3" />
                    </button>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tableData.map((row) => (
                  <TableRow
                    key={row.symbol}
                    className={row.hasError ? 'opacity-50' : ''}
                  >
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span
                          className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: row.color }}
                        />
                        <Link
                          href={`/market/${encodeURIComponent(row.symbol)}`}
                          className="font-mono font-medium hover:underline"
                        >
                          {row.symbol}
                        </Link>
                        {row.hasError && (
                          <AlertCircle className="h-3.5 w-3.5 text-destructive" />
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono">
                      {row.price != null ? `$${row.price.toFixed(2)}` : '--'}
                    </TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          'font-mono text-sm',
                          row.changePct != null && row.changePct >= 0
                            ? 'text-gain'
                            : 'text-loss'
                        )}
                      >
                        {row.changePct != null
                          ? formatPercent(row.changePct)
                          : '--'}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          'font-mono text-sm',
                          row.change1M != null && row.change1M >= 0
                            ? 'text-gain'
                            : 'text-loss'
                        )}
                      >
                        {row.change1M != null
                          ? formatPercent(row.change1M)
                          : '--'}
                      </span>
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {formatLargeNumber(row.marketCap)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* ─── Empty state ────────────────────────────────────────────── */}
      {symbols.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
          <div className="h-16 w-16 rounded-2xl bg-muted flex items-center justify-center">
            <TrendingUpIcon className="h-8 w-8 text-muted-foreground" />
          </div>
          <h2 className="text-lg font-semibold">{t.market.compare_performance}</h2>
          <p className="text-sm text-muted-foreground max-w-sm">
            {t.market.add_up_to_5}
          </p>
        </div>
      )}
    </div>
  )
}

// Simple trending icon for empty state
function TrendingUpIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
      <polyline points="16 7 22 7 22 13" />
    </svg>
  )
}

// ─── Main Export (wrapped in Suspense for useSearchParams) ────────────
export default function ComparePage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-6 max-w-4xl mx-auto">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-24 w-full rounded-2xl" />
          <Skeleton className="h-[400px] w-full rounded-2xl" />
        </div>
      }
    >
      <ComparePageInner />
    </Suspense>
  )
}
