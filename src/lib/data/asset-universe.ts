// Curated universe of ~100 relevant assets grouped by sector. Used to power the
// "explore by sector" breakdown and to keep these symbols warm in the daily
// baselines cron. Sector labels are the user-facing Spanish taxonomy.
//
// Keep this list deterministic and hand-maintained — it's the controlled set the
// product analyses, not a live market ranking.

export type Sector =
  | 'Tecnología'
  | 'Finanzas'
  | 'Consumo'
  | 'Energía'
  | 'Salud'
  | 'Industriales'
  | 'Comunicación'
  | 'Materiales'
  | 'Servicios Públicos'
  | 'Inmobiliario'
  | 'ETFs'

export type UniverseAsset = { symbol: string; name: string; sector: Sector }

export const SECTORS: Sector[] = [
  'Tecnología',
  'Finanzas',
  'Consumo',
  'Salud',
  'Comunicación',
  'Industriales',
  'Energía',
  'Materiales',
  'Servicios Públicos',
  'Inmobiliario',
  'ETFs',
]

export const ASSET_UNIVERSE: UniverseAsset[] = [
  // ─── Tecnología ─────────────────────────────────────────────────────────────
  { symbol: 'AAPL', name: 'Apple', sector: 'Tecnología' },
  { symbol: 'MSFT', name: 'Microsoft', sector: 'Tecnología' },
  { symbol: 'NVDA', name: 'NVIDIA', sector: 'Tecnología' },
  { symbol: 'AVGO', name: 'Broadcom', sector: 'Tecnología' },
  { symbol: 'ORCL', name: 'Oracle', sector: 'Tecnología' },
  { symbol: 'ADBE', name: 'Adobe', sector: 'Tecnología' },
  { symbol: 'CRM', name: 'Salesforce', sector: 'Tecnología' },
  { symbol: 'AMD', name: 'Advanced Micro Devices', sector: 'Tecnología' },
  { symbol: 'INTC', name: 'Intel', sector: 'Tecnología' },
  { symbol: 'CSCO', name: 'Cisco Systems', sector: 'Tecnología' },
  { symbol: 'QCOM', name: 'Qualcomm', sector: 'Tecnología' },
  { symbol: 'TXN', name: 'Texas Instruments', sector: 'Tecnología' },
  { symbol: 'IBM', name: 'IBM', sector: 'Tecnología' },
  { symbol: 'NOW', name: 'ServiceNow', sector: 'Tecnología' },

  // ─── Finanzas ───────────────────────────────────────────────────────────────
  { symbol: 'JPM', name: 'JPMorgan Chase', sector: 'Finanzas' },
  { symbol: 'BAC', name: 'Bank of America', sector: 'Finanzas' },
  { symbol: 'WFC', name: 'Wells Fargo', sector: 'Finanzas' },
  { symbol: 'GS', name: 'Goldman Sachs', sector: 'Finanzas' },
  { symbol: 'MS', name: 'Morgan Stanley', sector: 'Finanzas' },
  { symbol: 'C', name: 'Citigroup', sector: 'Finanzas' },
  { symbol: 'V', name: 'Visa', sector: 'Finanzas' },
  { symbol: 'MA', name: 'Mastercard', sector: 'Finanzas' },
  { symbol: 'AXP', name: 'American Express', sector: 'Finanzas' },
  { symbol: 'BLK', name: 'BlackRock', sector: 'Finanzas' },
  { symbol: 'BRK.B', name: 'Berkshire Hathaway', sector: 'Finanzas' },
  { symbol: 'SCHW', name: 'Charles Schwab', sector: 'Finanzas' },

  // ─── Consumo ────────────────────────────────────────────────────────────────
  { symbol: 'AMZN', name: 'Amazon', sector: 'Consumo' },
  { symbol: 'TSLA', name: 'Tesla', sector: 'Consumo' },
  { symbol: 'HD', name: 'Home Depot', sector: 'Consumo' },
  { symbol: 'MCD', name: "McDonald's", sector: 'Consumo' },
  { symbol: 'NKE', name: 'Nike', sector: 'Consumo' },
  { symbol: 'SBUX', name: 'Starbucks', sector: 'Consumo' },
  { symbol: 'KO', name: 'Coca-Cola', sector: 'Consumo' },
  { symbol: 'PEP', name: 'PepsiCo', sector: 'Consumo' },
  { symbol: 'PG', name: 'Procter & Gamble', sector: 'Consumo' },
  { symbol: 'WMT', name: 'Walmart', sector: 'Consumo' },
  { symbol: 'COST', name: 'Costco', sector: 'Consumo' },
  { symbol: 'TGT', name: 'Target', sector: 'Consumo' },
  { symbol: 'LOW', name: "Lowe's", sector: 'Consumo' },

  // ─── Salud ──────────────────────────────────────────────────────────────────
  { symbol: 'UNH', name: 'UnitedHealth', sector: 'Salud' },
  { symbol: 'JNJ', name: 'Johnson & Johnson', sector: 'Salud' },
  { symbol: 'LLY', name: 'Eli Lilly', sector: 'Salud' },
  { symbol: 'PFE', name: 'Pfizer', sector: 'Salud' },
  { symbol: 'MRK', name: 'Merck', sector: 'Salud' },
  { symbol: 'ABBV', name: 'AbbVie', sector: 'Salud' },
  { symbol: 'TMO', name: 'Thermo Fisher', sector: 'Salud' },
  { symbol: 'ABT', name: 'Abbott Laboratories', sector: 'Salud' },
  { symbol: 'DHR', name: 'Danaher', sector: 'Salud' },
  { symbol: 'AMGN', name: 'Amgen', sector: 'Salud' },

  // ─── Comunicación ───────────────────────────────────────────────────────────
  { symbol: 'GOOGL', name: 'Alphabet (Google)', sector: 'Comunicación' },
  { symbol: 'META', name: 'Meta Platforms', sector: 'Comunicación' },
  { symbol: 'NFLX', name: 'Netflix', sector: 'Comunicación' },
  { symbol: 'DIS', name: 'Walt Disney', sector: 'Comunicación' },
  { symbol: 'CMCSA', name: 'Comcast', sector: 'Comunicación' },
  { symbol: 'T', name: 'AT&T', sector: 'Comunicación' },
  { symbol: 'VZ', name: 'Verizon', sector: 'Comunicación' },
  { symbol: 'TMUS', name: 'T-Mobile US', sector: 'Comunicación' },

  // ─── Industriales ───────────────────────────────────────────────────────────
  { symbol: 'CAT', name: 'Caterpillar', sector: 'Industriales' },
  { symbol: 'BA', name: 'Boeing', sector: 'Industriales' },
  { symbol: 'HON', name: 'Honeywell', sector: 'Industriales' },
  { symbol: 'GE', name: 'GE Aerospace', sector: 'Industriales' },
  { symbol: 'UPS', name: 'United Parcel Service', sector: 'Industriales' },
  { symbol: 'RTX', name: 'RTX (Raytheon)', sector: 'Industriales' },
  { symbol: 'LMT', name: 'Lockheed Martin', sector: 'Industriales' },
  { symbol: 'DE', name: 'Deere & Company', sector: 'Industriales' },
  { symbol: 'UNP', name: 'Union Pacific', sector: 'Industriales' },

  // ─── Energía ────────────────────────────────────────────────────────────────
  { symbol: 'XOM', name: 'ExxonMobil', sector: 'Energía' },
  { symbol: 'CVX', name: 'Chevron', sector: 'Energía' },
  { symbol: 'COP', name: 'ConocoPhillips', sector: 'Energía' },
  { symbol: 'SLB', name: 'Schlumberger', sector: 'Energía' },
  { symbol: 'EOG', name: 'EOG Resources', sector: 'Energía' },
  { symbol: 'PSX', name: 'Phillips 66', sector: 'Energía' },
  { symbol: 'MPC', name: 'Marathon Petroleum', sector: 'Energía' },

  // ─── Materiales ─────────────────────────────────────────────────────────────
  { symbol: 'LIN', name: 'Linde', sector: 'Materiales' },
  { symbol: 'SHW', name: 'Sherwin-Williams', sector: 'Materiales' },
  { symbol: 'FCX', name: 'Freeport-McMoRan', sector: 'Materiales' },
  { symbol: 'NEM', name: 'Newmont', sector: 'Materiales' },
  { symbol: 'APD', name: 'Air Products', sector: 'Materiales' },

  // ─── Servicios Públicos ─────────────────────────────────────────────────────
  { symbol: 'NEE', name: 'NextEra Energy', sector: 'Servicios Públicos' },
  { symbol: 'DUK', name: 'Duke Energy', sector: 'Servicios Públicos' },
  { symbol: 'SO', name: 'Southern Company', sector: 'Servicios Públicos' },
  { symbol: 'D', name: 'Dominion Energy', sector: 'Servicios Públicos' },

  // ─── Inmobiliario ───────────────────────────────────────────────────────────
  { symbol: 'AMT', name: 'American Tower', sector: 'Inmobiliario' },
  { symbol: 'PLD', name: 'Prologis', sector: 'Inmobiliario' },
  { symbol: 'O', name: 'Realty Income', sector: 'Inmobiliario' },
  { symbol: 'SPG', name: 'Simon Property Group', sector: 'Inmobiliario' },

  // ─── ETFs ───────────────────────────────────────────────────────────────────
  { symbol: 'SPY', name: 'SPDR S&P 500 ETF', sector: 'ETFs' },
  { symbol: 'QQQ', name: 'Invesco QQQ (Nasdaq 100)', sector: 'ETFs' },
  { symbol: 'VOO', name: 'Vanguard S&P 500 ETF', sector: 'ETFs' },
  { symbol: 'VTI', name: 'Vanguard Total Stock Market', sector: 'ETFs' },
  { symbol: 'DIA', name: 'SPDR Dow Jones ETF', sector: 'ETFs' },
  { symbol: 'IWM', name: 'iShares Russell 2000 ETF', sector: 'ETFs' },
  { symbol: 'GLD', name: 'SPDR Gold Shares', sector: 'ETFs' },
  { symbol: 'ARKK', name: 'ARK Innovation ETF', sector: 'ETFs' },
  { symbol: 'XLK', name: 'Technology Select Sector SPDR', sector: 'ETFs' },
  { symbol: 'XLE', name: 'Energy Select Sector SPDR', sector: 'ETFs' },
  { symbol: 'XLF', name: 'Financial Select Sector SPDR', sector: 'ETFs' },
  { symbol: 'VNQ', name: 'Vanguard Real Estate ETF', sector: 'ETFs' },
]

/** All universe symbols (deduped), e.g. to warm caches/baselines. */
export const UNIVERSE_SYMBOLS: string[] = [...new Set(ASSET_UNIVERSE.map((a) => a.symbol))]

/** Group the universe by sector, preserving SECTORS order. */
export function assetsBySector(): Array<{ sector: Sector; assets: UniverseAsset[] }> {
  return SECTORS.map((sector) => ({
    sector,
    assets: ASSET_UNIVERSE.filter((a) => a.sector === sector),
  })).filter((g) => g.assets.length > 0)
}

/** Look up an asset's curated metadata by symbol. */
export function findUniverseAsset(symbol: string): UniverseAsset | undefined {
  const s = symbol.toUpperCase()
  return ASSET_UNIVERSE.find((a) => a.symbol.toUpperCase() === s)
}
