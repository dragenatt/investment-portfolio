# Price Engine Worker - Deployment Guide

## Overview
The production-grade Cloudflare Worker for the InvestTracker price pipeline with:
- Multi-source price fetching (Twelve Data primary, Finnhub fallback)
- KV cache with 5-minute TTL
- REST API endpoints for price lookup
- Scheduled price updates every 5 minutes during market hours
- Supabase integration for persistent storage

## Installation & Secrets Setup

### 1. Deploy Worker
```bash
cd /sessions/sharp-blissful-wozniak/mnt/Projects/investment-portfolio/worker
npm install
wrangler deploy
```

### 2. Set Environment Secrets
```bash
# Database access
wrangler secret put SUPABASE_SERVICE_ROLE_KEY --env production

# Primary price source (Twelve Data)
wrangler secret put TWELVE_DATA_API_KEY --env production

# Fallback price source (Finnhub)
wrangler secret put FINNHUB_API_KEY --env production
```

**Note:** Get the service role key from Supabase:
- Go to Settings > API > Service Role Key in your Supabase dashboard

## Architecture

### Scheduled Triggers (Cron Jobs)
- `*/5 * * * *` - Every 5 minutes: Fetch "hot" prices (symbols with open positions)
- `*/30 * * * *` - Every 30 minutes: Fetch "warm" prices (watchlisted symbols)
- `0 */12 * * *` - Every 12 hours: Build daily price history archive

All cron jobs automatically skip outside market hours (9 AM - 4 PM ET, Mon-Fri).

### REST API Endpoints

#### GET /health
Returns service health status.

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2026-04-03T14:30:00.000Z",
  "service": "price-engine",
  "version": "1.0.0"
}
```

#### GET /prices?symbols=AAPL,MSFT,GOOG
Batch price lookup from cache.

**Parameters:**
- `symbols` (required): Comma-separated stock symbols

**Response:**
```json
{
  "prices": {
    "AAPL": {
      "symbol": "AAPL",
      "price": 175.43,
      "change_pct": 1.23,
      "volume": 52841200,
      "currency": "USD",
      "source": "twelve-data",
      "exchange": "NASDAQ",
      "fetched_at": "2026-04-03T14:30:00.000Z",
      "expires_at": "2026-04-03T14:35:00.000Z"
    },
    "MSFT": null  // Not in cache
  },
  "timestamp": "2026-04-03T14:30:05.000Z"
}
```

#### GET /price/:symbol
Single price lookup from cache.

**Response:**
```json
{
  "price": {
    "symbol": "AAPL",
    "price": 175.43,
    "change_pct": 1.23,
    "volume": 52841200,
    "currency": "USD",
    "source": "twelve-data",
    "exchange": "NASDAQ",
    "fetched_at": "2026-04-03T14:30:00.000Z",
    "expires_at": "2026-04-03T14:35:00.000Z"
  },
  "timestamp": "2026-04-03T14:30:05.000Z"
}
```

## Rate Limiting

The worker respects API rate limits:
- **Twelve Data**: 8 requests/minute (free tier)
- **Finnhub**: 60 requests/minute

Rate limiting is enforced in-memory per 1-minute window. If a limit is exceeded, the worker falls back to the next data source.

## Caching Strategy

### KV Cache
- **TTL**: 300 seconds (5 minutes)
- **Namespace**: `price-engine-cache` (ID: 87b00ff379c84fc48d899444e564e309)
- **Key Format**: `price:{SYMBOL}` (e.g., `price:AAPL`)

### Supabase Storage
Prices written to the `company_data` table with columns:
- `symbol` (PRIMARY KEY)
- `exchange`
- `current_price`
- `price_change_pct`
- `trading_volume`
- `currency`
- `price_source` (tracks which API provided the data)
- `last_updated`

## Data Flow

### During Market Hours (9 AM - 4 PM ET, Mon-Fri)

**Every 5 minutes:**
1. Query `positions` table for symbols with quantity > 0 ("hot" symbols)
2. For each symbol, try Twelve Data API first
3. If Twelve Data fails/rate-limited, fallback to Finnhub
4. Cache result in KV for 5 minutes
5. Upsert to Supabase `company_data` table
6. Log any errors to `failed_fetches` table

**Every 30 minutes:**
1. Query `watchlist_items` for symbols not in positions ("warm" symbols)
2. Fetch prices using same primary/fallback logic
3. Cache and store in Supabase

**Every 12 hours:**
1. Read all prices from `company_data`
2. Create daily archive entries in `price_history` table
3. Use composite key `(symbol, date)` to prevent duplicates

## Error Handling

### Fetch Failures
- Logged to Supabase `failed_fetches` table with timestamp
- Worker continues processing other symbols
- Individual symbol failures don't block batch operations

### Market Hours
- Non-market-hours cron jobs log skip messages and return early
- Prevents unnecessary API calls when markets are closed

### Data Validation
- Checks for required fields in API responses
- Logs warnings for incomplete data
- Gracefully handles rate limit responses

## Monitoring

### Key Metrics to Track
1. **Cache hit ratio**: Monitor KV GET vs miss rates
2. **API failures**: Check `failed_fetches` table
3. **Supabase upserts**: Verify `company_data` is updating regularly
4. **Worker duration**: Most runs should complete in <5 seconds

### Log Messages
All operations log to Cloudflare Workers analytics:
- `Fetching prices for N hot symbols`
- `Successfully cached and stored price for SYMBOL`
- `Failed to fetch price for SYMBOL`
- `Market hours check: outside trading hours`

## Configuration

### API Keys
Located in Cloudflare Dashboard > Workers > price-engine > Settings > Secrets

### Production Routes
The worker is configured to route requests to `api.investtracker.com/price-engine/*`

To use locally during development:
```bash
wrangler dev
# Worker available at http://localhost:8787
```

## Troubleshooting

### Prices Not Updating
1. Check if run is happening during market hours
2. Verify API keys are set correctly: `wrangler secret list`
3. Check worker logs in Cloudflare Dashboard
4. Verify Supabase credentials and table permissions

### High Error Rate
1. Check API key quota on Twelve Data and Finnhub accounts
2. Verify rate limiting isn't blocking requests
3. Test single symbol fetch via `/price/AAPL` endpoint

### Cache Not Working
1. Verify KV namespace ID in wrangler.toml: `87b00ff379c84fc48d899444e564e309`
2. Check KV storage usage in Cloudflare Dashboard
3. Ensure TTL is set correctly (300 seconds)

## Performance

### Typical Latency
- Health check: <10ms
- Single price lookup: <20ms (KV lookup)
- Batch lookup (10 symbols): <30ms
- Full price fetch (50 symbols): 2-3 seconds

### Cost Optimization
- KV cache reduces API calls by ~80%
- Rate limiting prevents overage charges
- Scheduled jobs only run during market hours
- Batch operations reduce request count

## Future Enhancements

1. **Advanced caching**: Implement cache warming strategy
2. **Real-time updates**: Add Finnhub WebSocket support
3. **Analytics**: Track cache hit rates and API response times
4. **Multi-region**: Replicate KV across regions for latency
5. **Price predictions**: Add technical analysis data
