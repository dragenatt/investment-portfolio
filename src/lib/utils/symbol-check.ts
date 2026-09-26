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
 * anything is written, and about the other spellings of every bare ticker, so
 * it can say which ones will never have a price and offer the one that will.
 * The same candidates are what the fix-symbol dialog suggests for a holding
 * that is already stored (fix-symbol-dialog.tsx).
 */

type Quote = { price: number | null } | undefined

/**
 * A ticker on the Brazilian exchange: four letters and a number, where the
 * number says what the paper is — 3 ordinary, 4 preferred, 34 and 35 a BDR, a
 * receipt for a foreign share. Providers only know them with ".SA".
 */
const B3_TICKER = /^[A-Z]{4}\d{1,2}$/

/** What to ask a provider about for a symbol as a file wrote it. */
export function quoteCandidates(symbol: string): string[] {
  const s = symbol.trim().toUpperCase()
  // Anything with a suffix, a prefix or a separator already names its market.
  if (!/^[A-Z0-9]+$/.test(s)) return [s]
  // A bare ticker may be a BMV one, which providers only know with ".MX", or a
  // Brazilian one. The suffixes are tried in that order: this is a Mexican app,
  // and only the first spelling that prices is ever offered.
  return B3_TICKER.test(s) ? [s, `${s}.MX`, `${s}.SA`] : [s, `${s}.MX`]
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
