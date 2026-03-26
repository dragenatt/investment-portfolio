// Portfolio export utilities — CSV generation and browser download

export type ExportTransaction = {
  type: string
  quantity: number
  price: number
  fees: number
  currency: string
  executed_at: string
  notes: string | null
  position?: {
    symbol: string
  }
  symbol?: string
}

export type ExportPosition = {
  symbol: string
  quantity: number
  avg_cost: number
  currentPrice?: number
  currency?: string
}

function escapeCSV(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('es-ES', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
  } catch {
    return iso
  }
}

const TX_TYPE_LABELS: Record<string, string> = {
  buy: 'Compra',
  sell: 'Venta',
  dividend: 'Dividendo',
  split: 'Split',
}

/**
 * Generate CSV string from transactions.
 * Header: Fecha, Símbolo, Tipo, Cantidad, Precio, Comisión, Moneda, Notas
 */
export function transactionsToCSV(transactions: ExportTransaction[]): string {
  const header = ['Fecha', 'Símbolo', 'Tipo', 'Cantidad', 'Precio', 'Comisión', 'Moneda', 'Notas']
  const rows = transactions.map((t) => [
    formatDate(t.executed_at),
    escapeCSV(t.position?.symbol ?? t.symbol ?? ''),
    TX_TYPE_LABELS[t.type] ?? t.type,
    t.quantity.toString(),
    t.price.toFixed(2),
    t.fees.toFixed(2),
    t.currency,
    escapeCSV(t.notes ?? ''),
  ])

  return [header.join(','), ...rows.map((r) => r.join(','))].join('\n')
}

/**
 * Generate CSV from positions summary.
 * Header: Símbolo, Cantidad, Precio Promedio, Valor Actual, Ganancia, Ganancia %
 */
export function positionsToCSV(positions: ExportPosition[]): string {
  const header = ['Símbolo', 'Cantidad', 'Precio Promedio', 'Valor Actual', 'Ganancia', 'Ganancia %']
  const rows = positions.map((p) => {
    const currentPrice = p.currentPrice ?? p.avg_cost
    const gain = (currentPrice - p.avg_cost) * p.quantity
    const gainPct = p.avg_cost > 0 ? ((currentPrice - p.avg_cost) / p.avg_cost) * 100 : 0
    return [
      escapeCSV(p.symbol),
      p.quantity.toString(),
      p.avg_cost.toFixed(2),
      currentPrice.toFixed(2),
      gain.toFixed(2),
      gainPct.toFixed(2) + '%',
    ]
  })

  return [header.join(','), ...rows.map((r) => r.join(','))].join('\n')
}

/**
 * Trigger browser download of a string as file.
 * Prepends UTF-8 BOM for Excel compatibility with Spanish characters.
 */
export function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob(['\uFEFF' + content], { type: mimeType + ';charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
