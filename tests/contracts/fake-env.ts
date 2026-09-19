// A synthetic environment the analytics route handlers can run in, whole, with
// no network and no database: an in-memory Supabase that answers the queries
// the routes make, and a market whose history and quotes are generated from
// each symbol's name. Every number here is made up — no real portfolio, no real
// price.

type Row = Record<string, unknown>

export const USER_ID = '00000000-0000-4000-8000-00000000c0de'
export const PID = '00000000-0000-4000-8000-0000000b00c5'

// ─── Synthetic market ────────────────────────────────────────────────────────

const DAY_MS = 86_400_000

function hash(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/** The last weekday before today: the latest close a real market would have. */
function lastSession(): number {
  let t = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()) - DAY_MS
  while ([0, 6].includes(new Date(t).getUTCDay())) t -= DAY_MS
  return t
}

const HISTORY_FROM = Date.UTC(2006, 0, 2)
/** How far back the stored tier (price_history) reaches; providers go further. */
const STORED_DAYS = 900

/** The currency a synthetic symbol is quoted in. */
export function quoteCurrency(symbol: string): string {
  const pair = /^USD([A-Z]{3})=X$/.exec(symbol)
  if (pair) return pair[1]
  return symbol.endsWith('.MX') ? 'MXN' : 'USD'
}

const cache = new Map<string, Array<{ date: string; close: number }>>()

/**
 * Daily closes, one per weekday since 2006: a lognormal walk seeded by the
 * symbol, so every run and every route sees the same series.
 */
export function syntheticCloses(symbol: string): Array<{ date: string; close: number }> {
  const cached = cache.get(symbol)
  if (cached) return cached
  const rand = mulberry32(hash(symbol))
  const normal = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand())
  const fx = /=X$/.test(symbol)
  const start = fx ? (symbol === 'USDMXN=X' ? 12 : 0.8) : 20 + (hash(symbol) % 200)
  const dailyVol = (fx ? 0.08 : 0.18 + (hash(symbol) % 10) / 100) / Math.sqrt(252)
  const drift = (fx ? 0.02 : 0.07) / 252
  const rows: Array<{ date: string; close: number }> = []
  let price = start
  for (let t = HISTORY_FROM, end = lastSession(); t <= end; t += DAY_MS) {
    if ([0, 6].includes(new Date(t).getUTCDay())) continue
    price *= Math.exp(drift - dailyVol ** 2 / 2 + dailyVol * normal())
    rows.push({ date: iso(t), close: Math.round(price * 10_000) / 10_000 })
  }
  cache.set(symbol, rows)
  return rows
}

function rangeStart(range: string): number {
  const end = lastSession()
  if (range === 'max') return HISTORY_FROM
  if (range === 'ytd') return Date.UTC(new Date(end).getUTCFullYear(), 0, 1)
  const m = /^(\d+)(d|mo|y)$/.exec(range)
  if (!m) return end - 365 * DAY_MS
  const n = Number(m[1])
  return end - n * (m[2] === 'd' ? 1 : m[2] === 'mo' ? 31 : 366) * DAY_MS
}

/** What market.getHistory returns: provider bars, newest last. */
export async function syntheticHistory(symbol: string, range = '1mo') {
  const from = iso(rangeStart(range))
  return syntheticCloses(symbol)
    .filter((r) => r.date >= from)
    .map((r) => ({
      date: `${r.date}T14:30:00.000Z`,
      open: r.close,
      high: r.close,
      low: r.close,
      close: r.close,
      adjClose: r.close,
      volume: 1_000_000 + (hash(symbol + r.date) % 500_000),
      currency: quoteCurrency(symbol),
    }))
}

/** What market.getBatchQuotes returns: the last synthetic close, a minute old. */
export async function syntheticQuotes(symbols: string[]) {
  const fetchedAt = new Date(Date.now() - 60_000).toISOString()
  return Object.fromEntries(
    symbols.map((symbol) => {
      const closes = syntheticCloses(symbol)
      const last = closes[closes.length - 1].close
      const previous = closes[closes.length - 2].close
      return [
        symbol,
        {
          price: last,
          previousClose: previous,
          change: last - previous,
          changePct: ((last - previous) / previous) * 100,
          currency: quoteCurrency(symbol),
          name: symbol,
          fetchedAt,
        },
      ]
    }),
  )
}

// ─── The synthetic book ──────────────────────────────────────────────────────

const today = () => lastSession()
const daysAgo = (days: number) => {
  let t = today() - days * DAY_MS
  while ([0, 6].includes(new Date(t).getUTCDay())) t -= DAY_MS
  return `${iso(t)}T15:00:00.000Z`
}

/** Four holdings in two currencies, in a book whose base is a third view of them. */
const HOLDINGS = [
  { symbol: 'AAPL', asset_type: 'stock', quantity: 10, avg_cost: 150, currency: 'USD' },
  { symbol: 'MSFT', asset_type: 'stock', quantity: 5, avg_cost: 300, currency: 'USD' },
  { symbol: 'VOO', asset_type: 'etf', quantity: 3, avg_cost: 400, currency: 'USD' },
  { symbol: 'WALMEX.MX', asset_type: 'stock', quantity: 100, avg_cost: 60, currency: 'MXN' },
]

const COMPANIES: Row[] = [
  { symbol: 'AAPL', sector: 'Technology', hq: 'United States', market_cap: 3e12, name: 'Synthetic A' },
  { symbol: 'MSFT', sector: 'Technology', hq: 'United States', market_cap: 3e12, name: 'Synthetic M' },
  { symbol: 'VOO', sector: 'ETF', hq: 'United States', market_cap: 5e11, name: 'Synthetic V' },
  { symbol: 'WALMEX.MX', sector: 'Consumer Defensive', hq: 'Mexico', market_cap: 1e12, name: 'Synthetic W' },
]

function book() {
  const bought = daysAgo(700)
  const positions: Row[] = HOLDINGS.map((h) => ({
    id: `pos-${h.symbol}`,
    portfolio_id: PID,
    ...h,
    opened_at: bought,
    deleted_at: null,
  }))
  const transactions: Row[] = []
  let n = 0
  const add = (symbol: string, type: string, quantity: number, price: number, executed_at: string) => {
    const position = positions.find((p) => p.symbol === symbol)!
    transactions.push({
      id: `tx-${++n}`,
      position_id: position.id,
      portfolio_id: PID,
      symbol,
      type,
      quantity,
      price,
      fees: 0,
      currency: position.currency,
      executed_at,
      created_at: executed_at,
      notes: null,
      position: { portfolio_id: PID, symbol, currency: position.currency },
    })
  }
  for (const h of HOLDINGS) add(h.symbol, 'buy', h.quantity, h.avg_cost, bought)
  add('AAPL', 'dividend', 10, 0.25, daysAgo(200))
  add('AAPL', 'dividend', 10, 0.25, daysAgo(20))
  add('MSFT', 'dividend', 5, 0.75, daysAgo(100))

  const withTransactions = positions.map((p) => ({
    ...p,
    transactions: transactions.filter((t) => t.position_id === p.id),
  }))
  const portfolio: Row = {
    id: PID,
    user_id: USER_ID,
    name: 'Cartera de contrato',
    description: null,
    base_currency: 'MXN',
    benchmark_symbol: 'SPY',
    cost_model: null,
    visibility: 'private',
    deleted_at: null,
    created_at: bought,
    positions: withTransactions,
  }
  return { portfolio, positions, transactions }
}

// ─── An in-memory Supabase ───────────────────────────────────────────────────

type Recorded = { eq: Record<string, unknown>; in: Record<string, unknown[]> }
type Source = Row[] | ((q: Recorded) => Row[])

const valueAt = (row: Row, path: string): unknown =>
  path.split('.').reduce<unknown>((v, key) => (v == null ? undefined : (v as Row)[key]), row)

function symbolsAsked(q: Recorded): string[] {
  const listed = q.in.symbol as string[] | undefined
  if (listed) return listed
  return typeof q.eq.symbol === 'string' ? [q.eq.symbol] : []
}

function tables(): Record<string, Source> {
  const { portfolio, positions, transactions } = book()
  const storedFrom = iso(lastSession() - STORED_DAYS * DAY_MS)
  return {
    portfolios: [portfolio],
    positions,
    transactions,
    company_data: COMPANIES,
    // Generated for whichever symbols are asked about, like a table that holds
    // every listing's history.
    price_history: (q) =>
      symbolsAsked(q).flatMap((symbol) =>
        syntheticCloses(symbol)
          .filter((r) => r.date >= storedFrom)
          .map((r) => ({ symbol, date: r.date, open: r.close, high: r.close, low: r.close, close: r.close, volume: 1_000_000, currency: quoteCurrency(symbol) })),
      ),
    benchmark_prices: (q) =>
      symbolsAsked(q).flatMap((symbol) =>
        syntheticCloses(symbol).filter((r) => r.date >= storedFrom).map((r) => ({ symbol, date: r.date, close: r.close })),
      ),
    current_prices: (q) =>
      symbolsAsked(q).map((symbol) => {
        const closes = syntheticCloses(symbol)
        const last = closes[closes.length - 1].close
        const previous = closes[closes.length - 2].close
        return {
          symbol,
          price: last,
          previous_close: previous,
          change_pct: ((last - previous) / previous) * 100,
          currency: quoteCurrency(symbol),
          name: symbol,
          fetched_at: new Date(Date.now() - 120_000).toISOString(),
          updated_at: new Date(Date.now() - 120_000).toISOString(),
        }
      }),
  }
}

/** Columns renamed in a select (`currency:base_currency`); embedded resources are pre-joined. */
function aliases(select: string): Array<[string, string]> {
  const out: Array<[string, string]> = []
  let depth = 0
  let item = ''
  for (const ch of `${select},`) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) {
      const m = /^\s*(\w+)\s*:\s*(\w+)\s*$/.exec(item)
      if (m) out.push([m[1], m[2]])
      item = ''
    } else item += ch
  }
  return out
}

type Result = { data: unknown; error: { message: string; code?: string } | null; count?: number | null }

class Query {
  private filters: Array<(row: Row) => boolean> = []
  private recorded: Recorded = { eq: {}, in: {} }
  private orders: Array<{ column: string; ascending: boolean }> = []
  private limitTo: number | null = null
  private rangeOf: [number, number] | null = null
  private mode: 'many' | 'single' | 'maybe' = 'many'
  private selected = '*'
  private op: 'select' | 'write' = 'select'
  private payload: unknown = null
  private head = false
  private countRows = false

  constructor(private source: Source) {}

  select(columns = '*', options?: { count?: string; head?: boolean }) {
    this.selected = columns
    this.head = Boolean(options?.head)
    this.countRows = Boolean(options?.count)
    return this
  }
  insert(values: unknown) { return this.write(values) }
  upsert(values: unknown) { return this.write(values) }
  update(values: unknown) { return this.write(values) }
  delete() { return this.write(null) }
  private write(values: unknown) {
    this.op = 'write'
    this.payload = values
    return this
  }

  eq(column: string, value: unknown) {
    this.recorded.eq[column] = value
    this.filters.push((r) => valueAt(r, column) === value)
    return this
  }
  neq(column: string, value: unknown) { this.filters.push((r) => valueAt(r, column) !== value); return this }
  gt(column: string, value: never) { this.filters.push((r) => (valueAt(r, column) as never) > value); return this }
  gte(column: string, value: never) { this.filters.push((r) => (valueAt(r, column) as never) >= value); return this }
  lt(column: string, value: never) { this.filters.push((r) => (valueAt(r, column) as never) < value); return this }
  lte(column: string, value: never) { this.filters.push((r) => (valueAt(r, column) as never) <= value); return this }
  in(column: string, values: unknown[]) {
    this.recorded.in[column] = values
    this.filters.push((r) => values.includes(valueAt(r, column)))
    return this
  }
  is(column: string, value: unknown) { this.filters.push((r) => (valueAt(r, column) ?? null) === value); return this }
  not(column: string, operator: string, value: unknown) {
    if (operator === 'is') this.filters.push((r) => (valueAt(r, column) ?? null) !== value)
    return this
  }
  order(column: string, options?: { ascending?: boolean }) {
    this.orders.push({ column, ascending: options?.ascending !== false })
    return this
  }
  limit(n: number) { this.limitTo = n; return this }
  range(from: number, to: number) { this.rangeOf = [from, to]; return this }
  single() { this.mode = 'single'; return this }
  maybeSingle() { this.mode = 'maybe'; return this }

  private run(): Result {
    if (this.op === 'write') {
      const rows = Array.isArray(this.payload) ? this.payload : this.payload ? [this.payload] : []
      return { data: this.mode === 'many' ? rows : (rows[0] ?? null), error: null }
    }
    let rows = typeof this.source === 'function' ? this.source(this.recorded) : this.source
    rows = rows.filter((row) => this.filters.every((f) => f(row)))
    for (const { column, ascending } of [...this.orders].reverse()) {
      rows = [...rows].sort((a, b) => {
        const x = valueAt(a, column) as never
        const y = valueAt(b, column) as never
        return x === y ? 0 : (x < y ? -1 : 1) * (ascending ? 1 : -1)
      })
    }
    const count = rows.length
    if (this.rangeOf) rows = rows.slice(this.rangeOf[0], this.rangeOf[1] + 1)
    if (this.limitTo !== null) rows = rows.slice(0, this.limitTo)
    const renamed = aliases(this.selected)
    if (renamed.length > 0) rows = rows.map((r) => ({ ...r, ...Object.fromEntries(renamed.map(([alias, column]) => [alias, r[column]])) }))
    if (this.head) return { data: null, error: null, count }
    if (this.mode === 'single') {
      return rows.length === 1
        ? { data: rows[0], error: null }
        : { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' } }
    }
    if (this.mode === 'maybe') return { data: rows[0] ?? null, error: null }
    return { data: rows, error: null, count: this.countRows ? count : null }
  }

  then<A = Result, B = never>(resolve?: ((value: Result) => A | PromiseLike<A>) | null, reject?: ((reason: unknown) => B | PromiseLike<B>) | null) {
    return Promise.resolve().then(() => this.run()).then(resolve, reject)
  }
}

/** A query whose unknown methods are no-ops that keep the chain going. */
function query(source: Source) {
  const target = new Query(source)
  const proxy: unknown = new Proxy(target, {
    get(obj, prop, receiver) {
      if (prop in obj) {
        const value = Reflect.get(obj, prop, receiver)
        return typeof value === 'function'
          ? (...args: unknown[]) => {
              const out = (value as (...a: unknown[]) => unknown).apply(obj, args)
              return out === obj ? proxy : out
            }
          : value
      }
      return () => proxy
    },
  })
  return proxy as Query
}

/** The Supabase client the routes get: the test user, and the synthetic book. */
export function fakeSupabase() {
  const data = tables()
  return {
    auth: {
      getUser: async () => ({ data: { user: { id: USER_ID, email: 'contrato@example.test' } }, error: null }),
      getSession: async () => ({ data: { session: null }, error: null }),
    },
    from: (table: string) => query(data[table] ?? []),
    rpc: () => query([]),
  }
}
