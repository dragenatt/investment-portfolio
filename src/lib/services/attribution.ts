/**
 * BHB Attribution Analysis (Brinson-Hood-Beebower)
 *
 * Decomposes portfolio excess return into:
 * - Allocation effect: impact of sector weight decisions
 * - Selection effect: impact of stock picking within sectors
 * - Interaction effect: combined effect
 */

// S&P 500 sector weights (approximate, updated quarterly)
export const SP500_SECTOR_WEIGHTS: Record<string, number> = {
  'Technology': 0.31,
  'Healthcare': 0.12,
  'Financial Services': 0.13,
  'Consumer Cyclical': 0.10,
  'Communication Services': 0.09,
  'Industrials': 0.08,
  'Consumer Defensive': 0.06,
  'Energy': 0.04,
  'Utilities': 0.03,
  'Real Estate': 0.02,
  'Basic Materials': 0.02,
}

export type SectorAttribution = {
  sector: string
  portfolio_weight: number
  benchmark_weight: number
  portfolio_return: number
  benchmark_return: number
  allocation_effect: number
  selection_effect: number
  interaction_effect: number
  total_effect: number
}

export function computeAttribution(
  portfolioSectors: Array<{ sector: string; weight: number; return_pct: number }>,
  benchmarkReturn: number,
  benchmarkWeights: Record<string, number> = SP500_SECTOR_WEIGHTS
): {
  sectors: SectorAttribution[]
  total: {
    allocation_effect: number
    selection_effect: number
    interaction_effect: number
    total_excess: number
  }
} {
  let totalAllocation = 0
  let totalSelection = 0
  let totalInteraction = 0
  const sectors: SectorAttribution[] = []

  // BHB formula:
  // Allocation = (Wp - Wb) * (Rb_sector - Rb_total)
  // Selection  = Wb * (Rp_sector - Rb_sector)
  // Interaction = (Wp - Wb) * (Rp_sector - Rb_sector)
  //
  // Since we don't have per-sector benchmark returns, we use the overall
  // benchmark return as the sector benchmark return approximation.
  const br = benchmarkReturn / 100 // as decimal

  for (const ps of portfolioSectors) {
    const bw = benchmarkWeights[ps.sector] ?? 0
    const pw = ps.weight
    const pr = ps.return_pct / 100 // portfolio sector return as decimal

    // Allocation: over/underweight decision × sector benchmark excess
    // Since we approximate with overall benchmark return for each sector,
    // allocation becomes (pw - bw) * br
    const allocation = (pw - bw) * br
    // Selection: benchmark weight × stock picking alpha
    const selection = bw * (pr - br)
    // Interaction: combined over/underweight × alpha
    const interaction = (pw - bw) * (pr - br)

    const total_effect = allocation + selection + interaction

    totalAllocation += allocation
    totalSelection += selection
    totalInteraction += interaction

    sectors.push({
      sector: ps.sector,
      portfolio_weight: pw,
      benchmark_weight: bw,
      portfolio_return: ps.return_pct,
      benchmark_return: benchmarkReturn,
      allocation_effect: allocation * 100,
      selection_effect: selection * 100,
      interaction_effect: interaction * 100,
      total_effect: total_effect * 100,
    })
  }

  const totalExcess = totalAllocation + totalSelection + totalInteraction

  return {
    sectors,
    total: {
      allocation_effect: totalAllocation * 100,
      selection_effect: totalSelection * 100,
      interaction_effect: totalInteraction * 100,
      total_excess: totalExcess * 100,
    },
  }
}

// ─── Contribution to return (P0-10) ─────────────────────────────────────────
//
// The sector model above answers "was I in the right places". This answers the
// blunter question a reader asks first: which holdings actually produced the
// number at the top of the page.
//
// Contribution is weight times return, and the reason it is the right unit is
// that the parts add up to the whole — a 40% gain on 2% of the book contributes
// less than a 3% gain on half of it, which no ranking by return alone reveals.

export type PositionReturn = {
  symbol: string
  sector?: string
  /** Fraction of the portfolio, not a percentage. */
  weight: number
  /** Percentage return over the period. */
  returnPct: number
  realizedPnl?: number
  unrealizedPnl?: number
}

export type AssetContribution = {
  symbol: string
  sector: string
  weight: number
  returnPct: number
  /** weight x returnPct. These sum to the portfolio return. */
  contributionPct: number
  realizedPnl: number | null
  unrealizedPnl: number | null
}

export type SectorContribution = {
  sector: string
  weight: number
  contributionPct: number
}

export type ContributionAnalysis = {
  assets: AssetContribution[]
  bySector: SectorContribution[]
  totalReturnPct: number
  totalRealizedPnl: number | null
  totalUnrealizedPnl: number | null
  /** Largest contributor first, each step carrying the running total. */
  waterfall: Array<{ label: string; value: number; cumulative: number }>
}

const UNKNOWN_SECTOR = 'Unknown'

/**
 * Decompose a portfolio return into the holdings that produced it.
 *
 * Positions whose weight or return is not a usable number are dropped rather
 * than folded in: one NaN would otherwise make the entire total NaN, and a
 * portfolio return of "NaN%" is worse than a total that openly covers fewer
 * positions.
 */
export function contributionByAsset(positions: PositionReturn[]): ContributionAnalysis {
  const usable = positions.filter(
    (p) => Number.isFinite(p.weight) && Number.isFinite(p.returnPct),
  )

  const assets: AssetContribution[] = usable
    .map((p) => ({
      symbol: p.symbol,
      sector: p.sector ?? UNKNOWN_SECTOR,
      weight: p.weight,
      returnPct: p.returnPct,
      contributionPct: p.weight * p.returnPct,
      realizedPnl: Number.isFinite(p.realizedPnl as number) ? (p.realizedPnl as number) : null,
      unrealizedPnl: Number.isFinite(p.unrealizedPnl as number) ? (p.unrealizedPnl as number) : null,
    }))
    .sort((a, b) => b.contributionPct - a.contributionPct)

  const totalReturnPct = assets.reduce((sum, a) => sum + a.contributionPct, 0)

  const sectorMap = new Map<string, SectorContribution>()
  for (const asset of assets) {
    const existing = sectorMap.get(asset.sector)
    if (existing) {
      existing.weight += asset.weight
      existing.contributionPct += asset.contributionPct
    } else {
      sectorMap.set(asset.sector, {
        sector: asset.sector,
        weight: asset.weight,
        contributionPct: asset.contributionPct,
      })
    }
  }
  const bySector = [...sectorMap.values()].sort((a, b) => b.contributionPct - a.contributionPct)

  const realized = assets.filter((a) => a.realizedPnl !== null)
  const unrealized = assets.filter((a) => a.unrealizedPnl !== null)

  let running = 0
  const waterfall = assets.map((a) => {
    running += a.contributionPct
    return { label: a.symbol, value: a.contributionPct, cumulative: running }
  })

  return {
    assets,
    bySector,
    totalReturnPct,
    totalRealizedPnl:
      realized.length === 0 ? null : realized.reduce((s, a) => s + (a.realizedPnl as number), 0),
    totalUnrealizedPnl:
      unrealized.length === 0
        ? null
        : unrealized.reduce((s, a) => s + (a.unrealizedPnl as number), 0),
    waterfall,
  }
}
