export type CSVRow = {
  date: string
  symbol: string
  type: 'buy' | 'sell' | 'dividend'
  quantity: number
  price: number
  fees: number
  currency: string
  notes?: string
}

type ParseResult = {
  rows: CSVRow[]
  errors: string[]
}

// Column mapping for known formats
const COLUMN_ALIASES: Record<string, keyof CSVRow> = {
  // Standard English
  date: 'date',
  symbol: 'symbol',
  ticker: 'symbol',
  type: 'type',
  action: 'type',
  quantity: 'quantity',
  qty: 'quantity',
  shares: 'quantity',
  price: 'price',
  fees: 'fees',
  fee: 'fees',
  commission: 'fees',
  currency: 'currency',
  notes: 'notes',
  note: 'notes',
  // GBM+ (Spanish broker)
  fecha: 'date',
  emisora: 'symbol',
  'operación': 'type',
  operacion: 'type',
  'títulos': 'quantity',
  titulos: 'quantity',
  precio: 'price',
  'comisión': 'fees',
  comision: 'fees',
  moneda: 'currency',
  notas: 'notes',
}

const TYPE_ALIASES: Record<string, 'buy' | 'sell' | 'dividend'> = {
  buy: 'buy',
  compra: 'buy',
  sell: 'sell',
  venta: 'sell',
  dividend: 'dividend',
  dividendo: 'dividend',
}

function stripBOM(text: string): string {
  // Remove UTF-8 BOM if present
  if (text.charCodeAt(0) === 0xFEFF) {
    return text.slice(1)
  }
  return text
}

function detectDelimiter(headerLine: string): string {
  // Try common delimiters and pick the one that produces the most columns
  const delimiters = [',', ';', '\t', '|']
  let best = ','
  let bestCount = 0
  for (const d of delimiters) {
    const count = headerLine.split(d).length
    if (count > bestCount) {
      bestCount = count
      best = d
    }
  }
  return best
}

function parseLine(line: string, delimiter: string): string[] {
  const fields: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"'
          i++ // skip escaped quote
        } else {
          inQuotes = false
        }
      } else {
        current += ch
      }
    } else {
      if (ch === '"') {
        inQuotes = true
      } else if (ch === delimiter) {
        fields.push(current.trim())
        current = ''
      } else {
        current += ch
      }
    }
  }
  fields.push(current.trim())
  return fields
}

function normalizeDate(raw: string): string | null {
  // Try ISO format first (YYYY-MM-DD or full datetime)
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    const d = new Date(raw)
    if (!isNaN(d.getTime())) return d.toISOString()
  }

  // DD/MM/YYYY or DD-MM-YYYY
  const ddmmyyyy = raw.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/)
  if (ddmmyyyy) {
    const [, day, month, year] = ddmmyyyy
    const d = new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T12:00:00Z`)
    if (!isNaN(d.getTime())) return d.toISOString()
  }

  // MM/DD/YYYY (US format) — ambiguous, try as fallback
  const mmddyyyy = raw.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/)
  if (mmddyyyy) {
    const [, month, day, year] = mmddyyyy
    const d = new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T12:00:00Z`)
    if (!isNaN(d.getTime())) return d.toISOString()
  }

  return null
}

function parseNumber(raw: string): number | null {
  if (!raw || raw === '-') return 0
  // Handle numbers with comma as decimal separator (e.g., "1.234,56" -> "1234.56")
  let cleaned = raw.replace(/[$€\s]/g, '')
  if (/,\d{1,2}$/.test(cleaned)) {
    // European format: 1.234,56 or simple comma decimal: 10,50
    cleaned = cleaned.replace(/\./g, '').replace(',', '.')
  } else {
    // Remove thousand-separator commas
    cleaned = cleaned.replace(/,/g, '')
  }
  const n = Number(cleaned)
  return isNaN(n) ? null : n
}

export function parseCSV(text: string): ParseResult {
  const rows: CSVRow[] = []
  const errors: string[] = []

  const cleaned = stripBOM(text)
  const lines = cleaned.split(/\r?\n/).filter((l) => l.trim().length > 0)

  if (lines.length < 2) {
    errors.push('El archivo debe tener al menos un encabezado y una fila de datos')
    return { rows, errors }
  }

  const delimiter = detectDelimiter(lines[0])
  const headerRaw = parseLine(lines[0], delimiter)
  const headers = headerRaw.map((h) => h.toLowerCase().trim())

  // Map headers to CSVRow keys
  const columnMap: (keyof CSVRow | null)[] = headers.map((h) => {
    // Remove accents for matching
    const normalized = h.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    return COLUMN_ALIASES[h] ?? COLUMN_ALIASES[normalized] ?? null
  })

  // Check required columns
  const mappedKeys = new Set(columnMap.filter(Boolean))
  const required: (keyof CSVRow)[] = ['date', 'symbol', 'type', 'quantity', 'price']
  const missing = required.filter((k) => !mappedKeys.has(k))
  if (missing.length > 0) {
    errors.push(`Columnas requeridas no encontradas: ${missing.join(', ')}. Columnas detectadas: ${headers.join(', ')}`)
    return { rows, errors }
  }

  for (let i = 1; i < lines.length; i++) {
    const lineNum = i + 1
    const fields = parseLine(lines[i], delimiter)

    // Build a raw record from column mapping
    const raw: Record<string, string> = {}
    for (let j = 0; j < columnMap.length; j++) {
      const key = columnMap[j]
      if (key && j < fields.length) {
        raw[key] = fields[j]
      }
    }

    // Validate and convert each field
    const rowErrors: string[] = []

    // Date
    const date = normalizeDate(raw.date ?? '')
    if (!date) rowErrors.push('fecha invalida')

    // Symbol
    const symbol = (raw.symbol ?? '').toUpperCase().trim()
    if (!symbol) rowErrors.push('simbolo vacio')
    if (symbol && !/^[A-Z0-9.\-:=^]+$/.test(symbol)) rowErrors.push(`simbolo invalido: ${symbol}`)

    // Type
    const typeRaw = (raw.type ?? '').toLowerCase().trim()
    const type = TYPE_ALIASES[typeRaw]
    if (!type) rowErrors.push(`tipo invalido: "${raw.type}"`)

    // Quantity
    const quantity = parseNumber(raw.quantity ?? '')
    if (quantity === null || quantity <= 0) rowErrors.push('cantidad invalida')

    // Price
    const price = parseNumber(raw.price ?? '')
    if (price === null || price <= 0) rowErrors.push('precio invalido')

    // Fees (optional, default 0)
    const feesRaw = raw.fees ?? '0'
    const fees = parseNumber(feesRaw)
    if (fees === null || fees < 0) rowErrors.push('comision invalida')

    // Currency (optional, default USD)
    const currency = (raw.currency ?? 'USD').toUpperCase().trim()
    if (!['MXN', 'USD', 'EUR'].includes(currency)) rowErrors.push(`moneda no soportada: ${currency}`)

    // Notes (optional)
    const notes = raw.notes?.trim() || undefined

    if (rowErrors.length > 0) {
      errors.push(`Fila ${lineNum}: ${rowErrors.join('; ')}`)
    } else {
      rows.push({
        date: date!,
        symbol,
        type: type!,
        quantity: quantity!,
        price: price!,
        fees: fees ?? 0,
        currency,
        notes,
      })
    }
  }

  return { rows, errors }
}
