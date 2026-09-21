/**
 * Which symbols in an import can actually be priced.
 *
 * A symbol no provider recognises is accepted, stored and never quoted: the
 * position is valued at what it cost for as long as it exists, with no price,
 * no return and no chart, and nothing tells its owner why. Production has six
 * such holdings, all from files: Mexican tickers without the exchange suffix
 * ("FEMSAUBD" for FEMSAUBD.MX), a broker's own names for funds, a test symbol.
 *
 * The import preview asks the quote service about every symbol before
 * anything is written, and about the BMV spelling of every bare ticker, so it
 * can say which ones will never have a price and offer the one that will.
 */

type Quote = { price: number | null } | undefined

/** What to ask a provider about for a symbol as a file wrote it. */
export function quoteCandidates(symbol: string): string[] {
  const s = symbol.trim().toUpperCase()
  // A bare ticker may be a BMV one, which providers only know with ".MX".
  // Anything with a suffix, a prefix or a separator already names its market.
  return /^[A-Z0-9]+$/.test(s) ? [s, `${s}.MX`] : [s]
}

export type SymbolCheck = {
  /** Symbols a provider prices as written. */
  quoted: string[]
  /** Symbols that price only under another spelling: file symbol → that spelling. */
  suggestions: Record<string, string>
  /** Symbols nothing prices, under any spelling tried. */
  unknown: string[]
}

function priced(quotes: Record<string, Quote>, symbol: string): boolean {
  const quote = quotes[symbol] ?? quotes[symbol.toUpperCase()]
  return quote?.price != null && Number.isFinite(quote.price)
}

export function checkSymbols(symbols: string[], quotes: Record<string, Quote>): SymbolCheck {
  const result: SymbolCheck = { quoted: [], suggestions: {}, unknown: [] }
  for (const symbol of [...new Set(symbols)]) {
    const [asWritten, ...alternatives] = quoteCandidates(symbol)
    if (priced(quotes, asWritten)) {
      result.quoted.push(symbol)
      continue
    }
    const alternative = alternatives.find((candidate) => priced(quotes, candidate))
    if (alternative) result.suggestions[symbol] = alternative
    else result.unknown.push(symbol)
  }
  return result
}
