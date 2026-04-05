/**
 * Concentration Risk Service
 *
 * Evaluates portfolio concentration and generates alerts.
 */

import { type SupabaseClient } from '@supabase/supabase-js'

type ConcentrationAlert = {
  portfolio_id: string
  alert_type: string
  severity: 'warning' | 'critical'
  message: string
  details: Record<string, unknown>
}

export function evaluateConcentration(
  positions: Array<{ symbol: string; asset_type: string; value: number }>,
  totalValue: number,
  portfolioId: string,
  sectorMap?: Record<string, string>
): ConcentrationAlert[] {
  const alerts: ConcentrationAlert[] = []
  if (totalValue === 0) return alerts

  // Rule 1: Single position > 25% (warning), > 40% (critical)
  for (const pos of positions) {
    const weight = pos.value / totalValue
    if (weight > 0.40) {
      alerts.push({
        portfolio_id: portfolioId,
        alert_type: 'position_concentration',
        severity: 'critical',
        message: `${pos.symbol} represents ${(weight * 100).toFixed(1)}% of your portfolio`,
        details: { symbol: pos.symbol, weight, threshold: 0.40 },
      })
    } else if (weight > 0.25) {
      alerts.push({
        portfolio_id: portfolioId,
        alert_type: 'position_concentration',
        severity: 'warning',
        message: `${pos.symbol} represents ${(weight * 100).toFixed(1)}% of your portfolio`,
        details: { symbol: pos.symbol, weight, threshold: 0.25 },
      })
    }
  }

  // Rule 2: Sector > 50%
  if (sectorMap) {
    const sectorTotals: Record<string, number> = {}
    for (const pos of positions) {
      const sector = sectorMap[pos.symbol] ?? 'Unknown'
      sectorTotals[sector] = (sectorTotals[sector] || 0) + pos.value
    }
    for (const [sector, value] of Object.entries(sectorTotals)) {
      const weight = value / totalValue
      if (weight > 0.50 && sector !== 'Unknown') {
        alerts.push({
          portfolio_id: portfolioId,
          alert_type: 'sector_concentration',
          severity: 'warning',
          message: `${sector} sector is ${(weight * 100).toFixed(1)}% of your portfolio`,
          details: { sector, weight, threshold: 0.50 },
        })
      }
    }
  }

  // Rule 3: Single asset type > 80%
  const typeTotals: Record<string, number> = {}
  for (const pos of positions) {
    typeTotals[pos.asset_type] = (typeTotals[pos.asset_type] || 0) + pos.value
  }
  for (const [type, value] of Object.entries(typeTotals)) {
    const weight = value / totalValue
    if (weight > 0.80) {
      alerts.push({
        portfolio_id: portfolioId,
        alert_type: 'asset_type_concentration',
        severity: 'warning',
        message: `${(weight * 100).toFixed(1)}% of your portfolio is in ${type}`,
        details: { asset_type: type, weight, threshold: 0.80 },
      })
    }
  }

  return alerts
}

export async function saveAlerts(
  supabase: SupabaseClient,
  alerts: ConcentrationAlert[]
): Promise<void> {
  if (alerts.length === 0) return

  // Clear existing non-dismissed alerts for these portfolios
  const portfolioIds = [...new Set(alerts.map((a) => a.portfolio_id))]
  for (const pid of portfolioIds) {
    await supabase
      .from('portfolio_alerts')
      .delete()
      .eq('portfolio_id', pid)
      .eq('is_dismissed', false)
  }

  // Insert new alerts
  await supabase.from('portfolio_alerts').insert(
    alerts.map((a) => ({
      ...a,
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    }))
  )
}
