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
import { Upload, FileText, AlertCircle, CheckCircle2, ArrowLeft } from 'lucide-react'
import Link from 'next/link'

type ImportState = 'upload' | 'preview' | 'importing' | 'done'

export default function ImportCSVPage() {
  const { data: portfolios, isLoading: loadingPortfolios } = usePortfolios()
  const [portfolioId, setPortfolioId] = useState<string>('')
  const [state, setState] = useState<ImportState>('upload')
  const [rows, setRows] = useState<CSVRow[]>([])
  const [parseErrors, setParseErrors] = useState<string[]>([])
  const [importResult, setImportResult] = useState<{ imported: number; errors: string[] } | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFile = useCallback((file: File) => {
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setParseErrors(['El archivo debe ser un CSV (.csv)'])
      return
    }

    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result as string
      const result = parseCSV(text)
      setRows(result.rows)
      setParseErrors(result.errors)
      setState('preview')
    }
    reader.onerror = () => {
      setParseErrors(['Error al leer el archivo'])
    }
    reader.readAsText(file, 'utf-8')
  }, [])

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
      setImportResult({ imported: 0, errors: ['Error de conexion al servidor'] })
    }
    setState('done')
  }

  const reset = () => {
    setState('upload')
    setRows([])
    setParseErrors([])
    setImportResult(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/portfolio">
          <Button variant="ghost" size="icon-sm">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <h1 className="text-3xl font-bold">Importar CSV</h1>
      </div>

      {/* Portfolio selector */}
      <Card>
        <CardHeader>
          <CardTitle>Seleccionar portafolio</CardTitle>
          <CardDescription>
            Elige el portafolio donde se importaran las transacciones
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="max-w-sm">
            <Label htmlFor="portfolio-select" className="mb-2">
              Portafolio
            </Label>
            {loadingPortfolios ? (
              <p className="text-sm text-muted-foreground">Cargando portafolios...</p>
            ) : !portfolios || portfolios.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No tienes portafolios.{' '}
                <Link href="/portfolio/new" className="text-primary underline">
                  Crea uno primero
                </Link>
                .
              </p>
            ) : (
              <Select value={portfolioId} onValueChange={(v) => v && setPortfolioId(v)}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Selecciona un portafolio" />
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
            <CardTitle>Subir archivo</CardTitle>
            <CardDescription>
              Arrastra un archivo CSV o haz clic para seleccionarlo. Formatos
              soportados: estandar (Date, Symbol, Type, Quantity, Price, Fees,
              Currency) y GBM+ (Fecha, Emisora, Operacion, Titulos, Precio,
              Comision).
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
                Arrastra tu archivo CSV aqui o{' '}
                <span className="font-medium text-primary">haz clic para buscar</span>
              </p>
              <input
                ref={fileInputRef}
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
              Vista previa
            </CardTitle>
            <CardDescription>
              {rows.length} transacciones validas
              {parseErrors.length > 0 && `, ${parseErrors.length} con errores`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Parse errors */}
            {parseErrors.length > 0 && (
              <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-3">
                <div className="mb-2 flex items-center gap-2 text-sm font-medium text-destructive">
                  <AlertCircle className="h-4 w-4" />
                  Errores de formato ({parseErrors.length})
                </div>
                <ul className="space-y-1 text-sm text-destructive/90">
                  {parseErrors.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Data table */}
            {rows.length > 0 && (
              <div className="max-h-96 overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>#</TableHead>
                      <TableHead>Fecha</TableHead>
                      <TableHead>Simbolo</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead className="text-right">Cantidad</TableHead>
                      <TableHead className="text-right">Precio</TableHead>
                      <TableHead className="text-right">Comision</TableHead>
                      <TableHead>Moneda</TableHead>
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
                                ? 'bg-green-500/10 text-green-600'
                                : row.type === 'sell'
                                  ? 'bg-red-500/10 text-red-600'
                                  : 'bg-blue-500/10 text-blue-600'
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
                        <TableCell className="text-right">
                          ${row.price.toFixed(2)}
                        </TableCell>
                        <TableCell className="text-right">
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
                Importar {rows.length} transacciones
              </Button>
              <Button variant="outline" onClick={reset}>
                Cancelar
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
            <p className="text-sm">Importando transacciones...</p>
          </CardContent>
        </Card>
      )}

      {/* Results */}
      {state === 'done' && importResult && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {importResult.imported > 0 ? (
                <CheckCircle2 className="h-5 w-5 text-green-600" />
              ) : (
                <AlertCircle className="h-5 w-5 text-destructive" />
              )}
              Resultado de la importacion
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {importResult.imported > 0 && (
              <p className="text-sm text-green-600">
                {importResult.imported} transacciones importadas exitosamente.
              </p>
            )}
            {importResult.errors.length > 0 && (
              <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-3">
                <p className="mb-2 text-sm font-medium text-destructive">
                  Errores ({importResult.errors.length})
                </p>
                <ul className="space-y-1 text-sm text-destructive/90">
                  {importResult.errors.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex items-center gap-3 pt-2">
              <Link href="/portfolio">
                <Button>Volver a portafolios</Button>
              </Link>
              <Button variant="outline" onClick={reset}>
                Importar otro archivo
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
