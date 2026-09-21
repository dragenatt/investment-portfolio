/**
 * The asset type a trade is recorded with, from the instrument type a search
 * provider reports (Twelve Data's instrument_type, Yahoo's quoteType).
 *
 * A REIT is listed equity: shares of a company that owns property, traded on
 * an exchange, as volatile as the stock market around it. This used to file it
 * with bonds, so a book holding real-estate trusts showed them under
 * "Renta fija" in the allocation and in the risk breakdown — the part of the
 * portfolio a reader counts on to be calm — and the concentration notice
 * called them "bonos".
 */
export function detectAssetType(typeStr?: string, symbol?: string): string {
  if (symbol?.startsWith('^')) return 'index'
  if (!typeStr) return 'stock'
  const t = typeStr.toLowerCase()
  if (t.includes('index')) return 'index'
  if (t.includes('etf') || t.includes('mutual fund')) return 'etf'
  if (t.includes('crypto') || t.includes('digital currency')) return 'crypto'
  if (t.includes('reit')) return 'stock'
  if (t.includes('bond') || t.includes('debt')) return 'bond'
  if (t.includes('forex') || t.includes('currency')) return 'forex'
  if (t.includes('commodity') || t.includes('futures')) return 'commodity'
  return 'stock'
}
