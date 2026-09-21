'use client'

import { useState, useCallback, useRef } from 'react'
import { usePortfolios } from '@/lib/hooks/use-portfolios'
import { parseCSV, type CSVRow } from '@/lib/utils/csv-parser'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Upload, FileText, AlertCircle, AlertTriangle, CheckCircle2, ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button-variants'
import { useTranslation } from '@/lib/i18n'
import { checkSymbols, quoteCandidates, type SymbolCheck } from '@/lib/utils/symbol-check'

type ImportState = 'upload' | 'preview' | 'importing' | 'done'

export default function ImportCSVPage() {
  const { t } = useTranslation()
  const { data: portfolios, isLoading: loadingPortfolios, error: portfoliosError } = usePortfolios()
  const [portfolioId, setPortfolioId] = useState<string>('')
  const [state, setState] = useState<ImportState>('upload')
  const [rows, setRows] = useState<CSVRow[]>([])
  const [parseErrors, setParseErrors] = useState<string[]>([])
  const [importResult, setImportResult] = useState<{ imported: number; errors: string[] } | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [symbolCheck, setSymbolCheck] = useState<SymbolCheck | null>(null)
  const [checkingSymbols, setCheckingSymbols] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Before anything is written, ask the quote service about every symbol in
  // the file (symbol-check.ts). A symbol no provider knows is imported and
  // then valued at its cost forever, with nothing on screen saying why.
  const verifySymbols = useCallback(async (parsed: CSVRow[]) => {
    const symbols = [...new Set(parsed.map((row) => row.symbol))]
    if (symbols.length === 0) {
      setSymbolCheck(null)
      return
    }
    setCheckingSymbols(true)
    try {
      const candidates = [...new Set(symbols.flatMap(quoteCandidates))]
      const quotes: Record<string, { price: number | null }> = {}
      // The batch route answers at most 100 symbols per request.
      for (let i = 0; i < candidates.length; i += 100) {
        const chunk = candidates.slice(i, i + 100)
        const res = await fetch(`/api/market/batch?symbols=${encodeURIComponent(chunk.join(','))}`)
        const json = await res.json()
        Object.assign(quotes, json.data ?? {})
      }
      setSymbolCheck(checkSymbols(symbols, quotes))
    } catch {
      // A check that failed says nothing about the symbols, and the import is
      // not held up by it.
      setSymbolCheck(null)
    } finally {
      setCheckingSymbols(false)
    }
  }, [])

  const applySuggestions = () => {
    if (!symbolCheck) return
    const { suggestions } = symbolCheck
    setRows((current) => current.map((row) => (suggestions[row.symbol] ? { ...row, symbol: suggestions[row.symbol] } : row)))
    setSymbolCheck({
      quoted: [...symbolCheck.quoted, ...Object.values(suggestions)],
      suggestions: {},
      unknown: symbolCheck.unknown,
    })
  }

  const handleFile = useCallback((file: File) => {
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setParseErrors([t.portfolio.import_csv_title])
      return
    }

    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result as string
      const result = parseCSV(text)
      setRows(result.rows)
      setParseErrors(result.errors)
      setState('preview')
      void verifySymbols(result.rows)
    }
    reader.onerror = () => {
      setParseErrors([t.common.error_occurred])
    }
    reader.readAsText(file, 'utf-8')
  }, [t.portfolio.import_csv_title, t.common.error_occurred, verifySymbols])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragOver(false)
      const file = e.dataTransfer.files[0]
      if (file) handleFile(file)
    },
    [handleFile]
  )

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) handleFile(file)
    },
    [handleFile]
  )

  const handleImport = async () => {
    if (!portfolioId || rows.length === 0) return

    setState('importing')
    try {
      const res = await fetch('/api/transaction/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          portfolio_id: portfolioId,
          asset_type: 'stock',
          rows,
        }),
      })
      const json = await res.json()
      if (json.error) {
        setImportResult({ imported: 0, errors: [json.error] })
      } else {
        setImportResult(json.data)
      }
    } catch {
      setImportResult({ imported: 0, errors: [t.common.error_occurred] })
    }
    setState('done')
  }

  const reset = () => {
    setState('upload')
    setRows([])
    setParseErrors([])
    setImportResult(null)
    setSymbolCheck(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/portfolio" className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })} aria-label="Volver a portafolios">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="text-3xl font-bold">{t.portfolio.import_csv_title}</h1>
      </div>

      {/* Portfolio selector */}
      <Card>
        <CardHeader>
          <CardTitle>{t.portfolio.select_portfolio}</CardTitle>
          <CardDescription>
            {t.portfolio.select_portfolio_desc}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="max-w-sm">
            <Label htmlFor="portfolio-select" className="mb-2">
              {t.portfolio.portfolio_field}
            </Label>
            {loadingPortfolios ? (
              <p className="text-sm text-muted-foreground">{t.portfolio.loading_portfolios}</p>
            ) : portfoliosError && !portfolios ? (
              // Not "create one first" when the list simply failed to load (C9).
              <p className="text-sm text-destructive" role="alert">
                No se pudieron cargar tus portafolios. Recarga la página para intentarlo de nuevo.
              </p>
            ) : !portfolios || portfolios.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t.portfolio.no_portfolios_owned}{' '}
                <Link href="/portfolio/new" className="text-primary underline">
                  Crea uno primero
                </Link>
                .
              </p>
            ) : (
              <Select value={portfolioId} onValueChange={(v) => v && setPortfolioId(v)}>
                <SelectTrigger className="w-full" aria-label={t.portfolio.select_portfolio}>
                  <SelectValue placeholder={t.portfolio.select_portfolio} />
                </SelectTrigger>
                <SelectContent>
                  {portfolios.map((p: Record<string, unknown>) => (
                    <SelectItem key={p.id as string} value={p.id as string}>
                      {p.name as string}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Upload area */}
      {state === 'upload' && portfolioId && (
        <Card>
          <CardHeader>
            <CardTitle>{t.portfolio.upload_file}</CardTitle>
            <CardDescription>
              {t.portfolio.drag_or_click}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div
              onDragOver={(e) => {
                e.preventDefault()
                setDragOver(true)
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-12 transition-colors ${
                dragOver
                  ? 'border-primary bg-primary/5'
                  : 'border-muted-foreground/25 hover:border-primary/50'
              }`}
            >
              <Upload className="h-10 w-10 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                {t.portfolio.drag_or_click}
              </p>
              <input
                ref={fileInputRef}
                aria-label={t.portfolio.drag_or_click}
                type="file"
                accept=".csv"
                onChange={handleFileInput}
                className="hidden"
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Preview */}
      {state === 'preview' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              {t.portfolio.preview}
            </CardTitle>
            <CardDescription>
              {rows.length} {t.portfolio.valid_transactions}
              {parseErrors.length > 0 && `, ${parseErrors.length} ${t.portfolio.format_errors}`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Parse errors */}
            {parseErrors.length > 0 && (
              <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-3">
                <div className="mb-2 flex items-center gap-2 text-sm font-medium text-destructive">
                  <AlertCircle className="h-4 w-4" />
                  {t.portfolio.format_errors} ({parseErrors.length})
                </div>
                <ul className="space-y-1 text-sm text-destructive/90">
                  {parseErrors.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Symbols no provider can price */}
            {checkingSymbols && (
              <p className="text-sm text-muted-foreground">Revisando que cada símbolo tenga cotización…</p>
            )}
            {symbolCheck && (Object.keys(symbolCheck.suggestions).length > 0 || symbolCheck.unknown.length > 0) && (
              <div role="status" className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
                <div className="flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-300">
                  <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                  Símbolos sin cotización ({Object.keys(symbolCheck.suggestions).length + symbolCheck.unknown.length})
                </div>
                <p className="text-sm text-muted-foreground">
                  Ningún proveedor de precios los reconoce tal como vienen en el archivo. Importados así, se valúan a
                  su costo para siempre: sin precio, sin rendimiento y sin gráfica.
                </p>
                {Object.keys(symbolCheck.suggestions).length > 0 && (
                  <div className="space-y-2">
                    <ul className="space-y-1 text-sm">
                      {Object.entries(symbolCheck.suggestions).map(([from, to]) => (
                        <li key={from}>
                          <span className="font-medium">{from}</span> se encontró como{' '}
                          <span className="font-medium">{to}</span>
                        </li>
                      ))}
                    </ul>
                    <Button size="sm" variant="outline" onClick={applySuggestions}>
                      Usar los símbolos sugeridos
                    </Button>
                  </div>
                )}
                {symbolCheck.unknown.length > 0 && (
                  <ul className="space-y-1 text-sm">
                    {symbolCheck.unknown.map((symbol) => (
                      <li key={symbol}>
                        <span className="font-medium">{symbol}</span>: no se encontró en ningún mercado.
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {/* Data table */}
            {rows.length > 0 && (
              <div className="max-h-96 overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>#</TableHead>
                      <TableHead>{t.portfolio.date}</TableHead>
                      <TableHead>{t.portfolio.symbol}</TableHead>
                      <TableHead>{t.portfolio.type}</TableHead>
                      <TableHead className="text-right">{t.portfolio.quantity}</TableHead>
                      <TableHead className="text-right">{t.portfolio.price}</TableHead>
                      <TableHead className="text-right">{t.portfolio.fees}</TableHead>
                      <TableHead>{t.trade.currency}</TableHead>
                      <TableHead>Notas</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                        <TableCell>
                          {new Date(row.date).toLocaleDateString('es-MX')}
                        </TableCell>
                        <TableCell className="font-medium">{row.symbol}</TableCell>
                        <TableCell>
                          <span
                            className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-medium ${
                              row.type === 'buy'
                                ? 'bg-green-500/10 text-gain'
                                : row.type === 'sell'
                                  ? 'bg-red-500/10 text-loss'
                                  : 'bg-blue-500/10 text-blue-700 dark:text-blue-300'
                            }`}
                          >
                            {row.type === 'buy'
                              ? 'Compra'
                              : row.type === 'sell'
                                ? 'Venta'
                                : 'Dividendo'}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">{row.quantity}</TableCell>
                        <TableCell className="text-right font-financial">
                          ${row.price.toFixed(2)}
                        </TableCell>
                        <TableCell className="text-right font-financial">
                          ${row.fees.toFixed(2)}
                        </TableCell>
                        <TableCell>{row.currency}</TableCell>
                        <TableCell className="max-w-32 truncate text-muted-foreground">
                          {row.notes || '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center gap-3 pt-2">
              <Button onClick={handleImport} disabled={rows.length === 0 || !portfolioId}>
                {t.portfolio.import} {rows.length} {t.portfolio.transactions}
              </Button>
              <Button variant="outline" onClick={reset}>
                {t.common.cancel}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Importing */}
      {state === 'importing' && (
        <Card>
          <CardContent className="flex items-center gap-3 py-8">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <p className="text-sm">{t.common.loading_data}</p>
          </CardContent>
        </Card>
      )}

      {/* Results */}
      {state === 'done' && importResult && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {importResult.imported > 0 ? (
                <CheckCircle2 className="h-5 w-5 text-gain" aria-hidden="true" />
              ) : (
                <AlertCircle className="h-5 w-5 text-destructive" />
              )}
              {t.portfolio.import_result}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {importResult.imported > 0 && (
              <p className="text-sm text-gain">
                {importResult.imported} {t.portfolio.transactions_imported}
              </p>
            )}
            {importResult.errors.length > 0 && (
              <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-3">
                <p className="mb-2 text-sm font-medium text-destructive">
                  {t.common.error} ({importResult.errors.length})
                </p>
                <ul className="space-y-1 text-sm text-destructive/90">
                  {importResult.errors.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex items-center gap-3 pt-2">
              <Link href="/portfolio" className={buttonVariants()} aria-label="Volver a portafolios">{t.portfolio.back_to_portfolios}</Link>
              <Button variant="outline" onClick={reset}>
                {t.portfolio.import_another}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
