# Price Engine Worker - Architecture & Code Structure

## File Structure
```
worker/
  src/
    index.ts           (533 lines - main worker code)
  wrangler.toml       (configuration)
  package.json        (dependencies)
  DEPLOYMENT.md       (deployment & setup guide)
  ARCHITECTURE.md     (this file)
```

## Core Components

### 1. Environment Interface
```typescript
interface Env {
  PRICE_CACHE: KVNamespace           // Cloudflare KV for caching
  SUPABASE_URL: string               // Supabase project URL
  SUPABASE_SERVICE_ROLE_KEY: string  // Database auth
  TWELVE_DATA_API_KEY: string        // Primary price source
  FINNHUB_API_KEY: string            // Fallback price source
}
```

### 2. Scheduled Execution
Three cron-based triggers:
- **Every 5 minutes**: `fetchHotPrices()` - symbols with open positions
- **Every 30 minutes**: `fetchWarmPrices()` - watchlisted symbols not in positions
- **Every 12 hours**: `buildDailyHistory()` - archive prices to history table

All skip if outside market hours (9 AM - 4 PM ET, Mon-Fri).

### 3. REST API Handler
Main `fetch()` handler routes requests:
- `GET /health` - service status
- `GET /prices?symbols=AAPL,MSFT` - batch lookup
- `GET /price/AAPL` - single symbol lookup

All endpoints:
- Return CORS headers (`Access-Control-Allow-*`)
- Include timestamp in response
- Handle errors gracefully with JSON error responses

## Fetch Flow

### Data Fetching Pipeline
```
Symbol to fetch
    |
    v
fetchPriceWithFallback()
    |
    +---> fetchFromTwelveData()     (Primary)
    |         |
    |         v
    |      Check rate limit
    |      Fetch from API
    |      Parse response
    |      Return PriceData or null
    |
    +---> fetchFromFinnhub()         (Fallback if primary fails)
             |
             v
          Check rate limit
          Fetch from API
          Parse response
          Return PriceData or null
    |
    v
PriceData or null
```

### Caching Pipeline
```
Fetch result (PriceData)
    |
    v
Store in KV (5-min TTL)
    |
    v
Upsert to Supabase company_data
    |
    v
Log errors if any
```

## Key Functions

### Scheduled Operations

**fetchHotPrices(supabase, env)**
- Gets positions with quantity > 0 from Supabase
- Fetches prices via `fetchAndCachePrices()`
- Only runs during market hours

**fetchWarmPrices(supabase, env)**
- Gets watchlist items not in positions
- Fetches prices via `fetchAndCachePrices()`
- Only runs during market hours

**buildDailyHistory(supabase, env)**
- Reads all prices from `company_data`
- Creates daily archive in `price_history` table
- Runs every 12 hours (off-hours)

### Batch Processing

**fetchAndCachePrices(symbols, supabase, env, category)**
- Splits symbols into batches of 10
- Uses Promise.allSettled() for parallel fetching
- Individual failures don't block other symbols
- For each symbol:
  1. Fetch via `fetchPriceWithFallback()`
  2. Cache in KV with 300-second TTL
  3. Upsert to Supabase
  4. Log any errors
- 200ms delay between batches

**fetchPriceWithFallback(symbol, env)**
- Tries Twelve Data first
- Falls back to Finnhub if primary fails
- Returns PriceData or null

### Data Source Adapters

**fetchFromTwelveData(symbol, env)**
```
Rate limit check (8/min) -> Fetch -> Parse -> Return PriceData
```
- Extracts: close, change_percent, volume, exchange
- Source identifier: "twelve-data"

**fetchFromFinnhub(symbol, env)**
```
Rate limit check (60/min) -> Fetch -> Parse -> Return PriceData
```
- Extracts: c (close), dp (% change), v (volume)
- Source identifier: "finnhub"

### REST API Handlers

**handleBatchPrices(request, env, corsHeaders)**
- Parses `?symbols=AAPL,MSFT,GOOG` from URL
- Looks up each symbol in KV via `getPriceFromCache()`
- Returns object with symbol -> price mappings (null if not cached)

**handleSinglePrice(symbol, env, corsHeaders)**
- Extracts symbol from URL path
- Looks up in KV via `getPriceFromCache()`
- Returns 404 if not found

**getPriceFromCache(symbol, env)**
- Gets from KV with key `price:{SYMBOL}`
- Parses JSON CacheEntry
- Deletes if parse fails
- Returns PriceData or null

### Utilities

**isMarketHours()**
- Returns true if 9 AM - 4 PM ET, Mon-Fri
- Converts UTC to ET automatically
- Used to skip off-hours fetches

**checkRateLimit(service, limit)**
- Per-service rate limiting in-memory
- 1-minute rolling window
- Returns false if limit exceeded
- Tracks per service (twelve-data, finnhub)

**logFailedFetch(supabase, symbol, source, error)**
- Inserts to `failed_fetches` table
- Includes timestamp and error message
- Catches and logs own errors

**sleep(ms)**
- Simple promise-based delay
- Used for batch delays to avoid rate limits

## Data Models

### PriceData
```typescript
{
  symbol: "AAPL",
  price: 175.43,
  change_pct: 1.23,
  volume: 52841200,
  currency: "USD",
  source: "twelve-data" | "finnhub",
  exchange: "NASDAQ" | "US",
  fetched_at: "2026-04-03T14:30:00Z",
  expires_at: "2026-04-03T14:35:00Z"
}
```

### CacheEntry (KV storage)
```typescript
{
  price: PriceData,
  timestamp: 1712419800000
}
```

### Supabase company_data
- symbol (PRIMARY KEY)
- exchange
- current_price
- price_change_pct
- trading_volume
- currency
- price_source (tracks which API)
- last_updated

## Rate Limiting Strategy

In-memory tracking per 1-minute window:

```typescript
requestCounts = {
  "twelve-data:1712419800": { count: 3, reset: 1712419860000 },
  "finnhub:1712419800": { count: 45, reset: 1712419860000 }
}
```

When limit reached for primary source, worker falls back to next source.

## Error Handling

1. **Network errors**: Caught in try-catch, logged, returns null
2. **API errors**: Check response.ok and data.status, return null
3. **Parse errors**: Catch JSON parse errors, log, continue
4. **DB errors**: Log and continue, don't block other symbols
5. **Rate limits**: Fall back to next source

Individual symbol failures logged to `failed_fetches` but don't stop batch.

## Constants & Configuration

```typescript
CACHE_TTL_SECONDS = 300              // 5 minutes
TWELVE_DATA_RATE_LIMIT = 8          // 8 req/min
FINNHUB_RATE_LIMIT = 60             // 60 req/min
MARKET_HOURS_START = 9              // 9 AM ET
MARKET_HOURS_END = 16               // 4 PM ET
```

## Performance Characteristics

- **Memory**: Minimal (rate limit state only)
- **CPU**: Limited by API call latency
- **Latency per price**: 50-500ms (API dependent)
- **Batch latency (50 symbols)**: 2-3 seconds (with delays)
- **KV latency**: <10ms per key

## Testing Locally

```bash
wrangler dev
# Test endpoints:
curl http://localhost:8787/health
curl "http://localhost:8787/prices?symbols=AAPL,MSFT"
curl http://localhost:8787/price/AAPL
```

## Deployment Checklist

- [ ] API keys set via `wrangler secret put`
- [ ] Supabase tables created (positions, watchlist_items, company_data, price_history, failed_fetches)
- [ ] KV namespace verified: `87b00ff379c84fc48d899444e564e309`
- [ ] wrangler.toml account_id set: `8b18281e7f5efd3d2dceef34f64184e4`
- [ ] Routes configured for production domain
- [ ] Test cron jobs in Cloudflare dashboard
- [ ] Verify prices appearing in company_data table
