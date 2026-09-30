// Curated universe of ~190 relevant assets grouped by sector — NYSE and Nasdaq
// names alongside the BMV's largest (the .MX symbols). Used to power the
// "explore by sector" breakdown, to keep these symbols warm in the daily
// baselines cron, and as the dictionary search falls back to when no provider
// answers (market.ts). Sector labels are the user-facing Spanish taxonomy.
//
// Keep this list deterministic and hand-maintained — it's the controlled set the
// product analyses, not a live market ranking. Keep the sectors roughly the same
// size, so the browser reads as a map of the market rather than of one corner of
// it. A symbol goes in only once it answers with a quote and a history: tickers
// get renamed and delisted (América Móvil's AMXL became AMXB.MX).

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
  { symbol: 'AMAT', name: 'Applied Materials', sector: 'Tecnología' },
  { symbol: 'MU', name: 'Micron Technology', sector: 'Tecnología' },
  { symbol: 'INTU', name: 'Intuit', sector: 'Tecnología' },
  { symbol: 'PANW', name: 'Palo Alto Networks', sector: 'Tecnología' },

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
  { symbol: 'PYPL', name: 'PayPal', sector: 'Finanzas' },
  { symbol: 'SPGI', name: 'S&P Global', sector: 'Finanzas' },
  { symbol: 'GFNORTEO.MX', name: 'Banorte', sector: 'Finanzas' },
  { symbol: 'GFINBURO.MX', name: 'Inbursa', sector: 'Finanzas' },
  { symbol: 'BBAJIOO.MX', name: 'Banco del Bajío', sector: 'Finanzas' },
  { symbol: 'Q.MX', name: 'Quálitas', sector: 'Finanzas' },

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
  { symbol: 'WALMEX.MX', name: 'Walmart de México', sector: 'Consumo' },
  { symbol: 'FEMSAUBD.MX', name: 'FEMSA', sector: 'Consumo' },
  { symbol: 'BIMBOA.MX', name: 'Grupo Bimbo', sector: 'Consumo' },
  { symbol: 'KOFUBL.MX', name: 'Coca-Cola FEMSA', sector: 'Consumo' },
  { symbol: 'AC.MX', name: 'Arca Continental', sector: 'Consumo' },
  { symbol: 'GRUMAB.MX', name: 'Gruma', sector: 'Consumo' },

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
  { symbol: 'ISRG', name: 'Intuitive Surgical', sector: 'Salud' },
  { symbol: 'VRTX', name: 'Vertex Pharmaceuticals', sector: 'Salud' },
  { symbol: 'GILD', name: 'Gilead Sciences', sector: 'Salud' },
  { symbol: 'BMY', name: 'Bristol-Myers Squibb', sector: 'Salud' },
  { symbol: 'CVS', name: 'CVS Health', sector: 'Salud' },
  { symbol: 'SYK', name: 'Stryker', sector: 'Salud' },
  { symbol: 'LABB.MX', name: 'Genomma Lab', sector: 'Salud' },

  // ─── Comunicación ───────────────────────────────────────────────────────────
  { symbol: 'GOOGL', name: 'Alphabet (Google)', sector: 'Comunicación' },
  { symbol: 'META', name: 'Meta Platforms', sector: 'Comunicación' },
  { symbol: 'NFLX', name: 'Netflix', sector: 'Comunicación' },
  { symbol: 'DIS', name: 'Walt Disney', sector: 'Comunicación' },
  { symbol: 'CMCSA', name: 'Comcast', sector: 'Comunicación' },
  { symbol: 'T', name: 'AT&T', sector: 'Comunicación' },
  { symbol: 'VZ', name: 'Verizon', sector: 'Comunicación' },
  { symbol: 'TMUS', name: 'T-Mobile US', sector: 'Comunicación' },
  { symbol: 'CHTR', name: 'Charter Communications', sector: 'Comunicación' },
  { symbol: 'TTWO', name: 'Take-Two Interactive', sector: 'Comunicación' },
  { symbol: 'SPOT', name: 'Spotify', sector: 'Comunicación' },
  { symbol: 'RBLX', name: 'Roblox', sector: 'Comunicación' },
  { symbol: 'OMC', name: 'Omnicom', sector: 'Comunicación' },
  { symbol: 'AMXB.MX', name: 'América Móvil', sector: 'Comunicación' },
  { symbol: 'TLEVISACPO.MX', name: 'Grupo Televisa', sector: 'Comunicación' },
  { symbol: 'MEGACPO.MX', name: 'Megacable', sector: 'Comunicación' },

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
  { symbol: 'ETN', name: 'Eaton', sector: 'Industriales' },
  { symbol: 'MMM', name: '3M', sector: 'Industriales' },
  { symbol: 'FDX', name: 'FedEx', sector: 'Industriales' },
  { symbol: 'NOC', name: 'Northrop Grumman', sector: 'Industriales' },
  { symbol: 'WM', name: 'Waste Management', sector: 'Industriales' },
  { symbol: 'GAPB.MX', name: 'GAP (Aeroportuario del Pacífico)', sector: 'Industriales' },
  { symbol: 'ASURB.MX', name: 'ASUR (Aeroportuario del Sureste)', sector: 'Industriales' },
  { symbol: 'OMAB.MX', name: 'OMA (Aeroportuario Centro Norte)', sector: 'Industriales' },

  // ─── Energía ────────────────────────────────────────────────────────────────
  { symbol: 'XOM', name: 'ExxonMobil', sector: 'Energía' },
  { symbol: 'CVX', name: 'Chevron', sector: 'Energía' },
  { symbol: 'COP', name: 'ConocoPhillips', sector: 'Energía' },
  { symbol: 'SLB', name: 'Schlumberger', sector: 'Energía' },
  { symbol: 'EOG', name: 'EOG Resources', sector: 'Energía' },
  { symbol: 'PSX', name: 'Phillips 66', sector: 'Energía' },
  { symbol: 'MPC', name: 'Marathon Petroleum', sector: 'Energía' },
  { symbol: 'OXY', name: 'Occidental Petroleum', sector: 'Energía' },
  { symbol: 'WMB', name: 'Williams Companies', sector: 'Energía' },
  { symbol: 'KMI', name: 'Kinder Morgan', sector: 'Energía' },
  { symbol: 'VLO', name: 'Valero Energy', sector: 'Energía' },
  { symbol: 'HAL', name: 'Halliburton', sector: 'Energía' },
  { symbol: 'BKR', name: 'Baker Hughes', sector: 'Energía' },
  { symbol: 'OKE', name: 'ONEOK', sector: 'Energía' },
  { symbol: 'DVN', name: 'Devon Energy', sector: 'Energía' },
  { symbol: 'FANG', name: 'Diamondback Energy', sector: 'Energía' },

  // ─── Materiales ─────────────────────────────────────────────────────────────
  { symbol: 'LIN', name: 'Linde', sector: 'Materiales' },
  { symbol: 'SHW', name: 'Sherwin-Williams', sector: 'Materiales' },
  { symbol: 'FCX', name: 'Freeport-McMoRan', sector: 'Materiales' },
  { symbol: 'NEM', name: 'Newmont', sector: 'Materiales' },
  { symbol: 'APD', name: 'Air Products', sector: 'Materiales' },
  { symbol: 'ECL', name: 'Ecolab', sector: 'Materiales' },
  { symbol: 'NUE', name: 'Nucor', sector: 'Materiales' },
  { symbol: 'DOW', name: 'Dow', sector: 'Materiales' },
  { symbol: 'DD', name: 'DuPont', sector: 'Materiales' },
  { symbol: 'VMC', name: 'Vulcan Materials', sector: 'Materiales' },
  { symbol: 'MLM', name: 'Martin Marietta', sector: 'Materiales' },
  { symbol: 'CTVA', name: 'Corteva', sector: 'Materiales' },
  { symbol: 'PPG', name: 'PPG Industries', sector: 'Materiales' },
  { symbol: 'GMEXICOB.MX', name: 'Grupo México', sector: 'Materiales' },
  { symbol: 'CEMEXCPO.MX', name: 'Cemex', sector: 'Materiales' },
  { symbol: 'ORBIA.MX', name: 'Orbia', sector: 'Materiales' },

  // ─── Servicios Públicos ─────────────────────────────────────────────────────
  { symbol: 'NEE', name: 'NextEra Energy', sector: 'Servicios Públicos' },
  { symbol: 'DUK', name: 'Duke Energy', sector: 'Servicios Públicos' },
  { symbol: 'SO', name: 'Southern Company', sector: 'Servicios Públicos' },
  { symbol: 'D', name: 'Dominion Energy', sector: 'Servicios Públicos' },
  { symbol: 'AEP', name: 'American Electric Power', sector: 'Servicios Públicos' },
  { symbol: 'EXC', name: 'Exelon', sector: 'Servicios Públicos' },
  { symbol: 'SRE', name: 'Sempra', sector: 'Servicios Públicos' },
  { symbol: 'XEL', name: 'Xcel Energy', sector: 'Servicios Públicos' },
  { symbol: 'PCG', name: 'PG&E', sector: 'Servicios Públicos' },
  { symbol: 'ED', name: 'Consolidated Edison', sector: 'Servicios Públicos' },
  { symbol: 'PEG', name: 'Public Service Enterprise Group', sector: 'Servicios Públicos' },
  { symbol: 'WEC', name: 'WEC Energy', sector: 'Servicios Públicos' },
  { symbol: 'CEG', name: 'Constellation Energy', sector: 'Servicios Públicos' },
  { symbol: 'VST', name: 'Vistra', sector: 'Servicios Públicos' },
  { symbol: 'AWK', name: 'American Water Works', sector: 'Servicios Públicos' },
  { symbol: 'EIX', name: 'Edison International', sector: 'Servicios Públicos' },

  // ─── Inmobiliario ───────────────────────────────────────────────────────────
  { symbol: 'AMT', name: 'American Tower', sector: 'Inmobiliario' },
  { symbol: 'PLD', name: 'Prologis', sector: 'Inmobiliario' },
  { symbol: 'O', name: 'Realty Income', sector: 'Inmobiliario' },
  { symbol: 'SPG', name: 'Simon Property Group', sector: 'Inmobiliario' },
  { symbol: 'EQIX', name: 'Equinix', sector: 'Inmobiliario' },
  { symbol: 'PSA', name: 'Public Storage', sector: 'Inmobiliario' },
  { symbol: 'WELL', name: 'Welltower', sector: 'Inmobiliario' },
  { symbol: 'DLR', name: 'Digital Realty', sector: 'Inmobiliario' },
  { symbol: 'CCI', name: 'Crown Castle', sector: 'Inmobiliario' },
  { symbol: 'VICI', name: 'VICI Properties', sector: 'Inmobiliario' },
  { symbol: 'IRM', name: 'Iron Mountain', sector: 'Inmobiliario' },
  { symbol: 'FUNO11.MX', name: 'Fibra Uno', sector: 'Inmobiliario' },
  { symbol: 'FIBRAPL14.MX', name: 'Fibra Prologis', sector: 'Inmobiliario' },
  { symbol: 'FIBRAMQ12.MX', name: 'Fibra Macquarie', sector: 'Inmobiliario' },
  { symbol: 'DANHOS13.MX', name: 'Fibra Danhos', sector: 'Inmobiliario' },
  { symbol: 'FMTY14.MX', name: 'Fibra Monterrey', sector: 'Inmobiliario' },

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
  { symbol: 'IVV', name: 'iShares Core S&P 500 ETF', sector: 'ETFs' },
  { symbol: 'VWO', name: 'Vanguard Emerging Markets ETF', sector: 'ETFs' },
  { symbol: 'EWW', name: 'iShares MSCI Mexico ETF', sector: 'ETFs' },
  { symbol: 'NAFTRACISHRS.MX', name: 'iShares NAFTRAC (IPC)', sector: 'ETFs' },
  { symbol: 'SCHD', name: 'Schwab US Dividend Equity ETF', sector: 'ETFs' },
  { symbol: 'TLT', name: 'iShares 20+ Year Treasury Bond', sector: 'ETFs' },
  { symbol: 'AGG', name: 'iShares Core US Aggregate Bond', sector: 'ETFs' },
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
