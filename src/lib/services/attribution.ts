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
