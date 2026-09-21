// What counts as a sector. Pure, no dependencies.
//
// company_data.sector holds two kinds of value. Most are industries —
// Technology, Health Care, Real Estate — and a few are the wrapper an
// instrument comes in: ETF, Index, Fund. The second kind is not a sector. A
// book of six broad index ETFs holds thousands of companies across every
// industry, and calling it "92% in the ETF sector" is the opposite of true.
//
// This lived in risk-sources.ts, which already knew. The concentration rule
// did not, and when the nightly job started filling company_data for funds
// and indices (2026-09-20) it began warning users about their "ETF sector".

/** Values the sector field carries that are asset classes, not sectors. */
const NOT_SECTORS = new Set(['etf', 'etfs', 'fund', 'funds', 'index', 'indices', 'mutual fund', 'n/a', 'na', 'none', 'unknown', '-'])

/** A company sector worth grouping by, or null for an empty value or an asset class posing as one. */
export function realSector(value: string | null | undefined): string | null {
  const sector = value?.trim()
  if (!sector || NOT_SECTORS.has(sector.toLowerCase())) return null
  return sector
}
