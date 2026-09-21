/**
 * Concentration Risk Service
 *
 * Evaluates portfolio concentration and generates alerts.
 */

import { type SupabaseClient } from '@supabase/supabase-js'
import { realSector } from './sectors'

const ASSET_TYPE_NAMES: Record<string, string> = {
  stock: 'acciones',
  etf: 'ETFs',
  crypto: 'cripto',
  bond: 'bonos',
  forex: 'divisas',
  commodity: 'materias primas',
  index: 'índices',
}

export type ConcentrationAlert = {
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
        message: `${pos.symbol} representa ${(weight * 100).toFixed(1)}% de tu portafolio`,
        details: { symbol: pos.symbol, weight, threshold: 0.40 },
      })
    } else if (weight > 0.25) {
      alerts.push({
        portfolio_id: portfolioId,
        alert_type: 'position_concentration',
        severity: 'warning',
        message: `${pos.symbol} representa ${(weight * 100).toFixed(1)}% de tu portafolio`,
        details: { symbol: pos.symbol, weight, threshold: 0.25 },
      })
    }
  }

  // Rule 2: Sector > 50%
  //
  // Only real sectors. "ETF" and "Index" arrive in the sector field too, and
  // they are wrappers, not industries: six broad index funds hold thousands of
  // companies across every sector. Counting them as one warned users that
  // their book was "92% in the ETF sector" — which is Rule 3's job, stated
  // correctly, as an asset type.
  if (sectorMap) {
    const sectorTotals: Record<string, number> = {}
    for (const pos of positions) {
      const sector = realSector(sectorMap[pos.symbol])
      if (!sector) continue
      sectorTotals[sector] = (sectorTotals[sector] || 0) + pos.value
    }
    for (const [sector, value] of Object.entries(sectorTotals)) {
      const weight = value / totalValue
      if (weight > 0.50) {
        alerts.push({
          portfolio_id: portfolioId,
          alert_type: 'sector_concentration',
          severity: 'warning',
          message: `El sector ${sector} es ${(weight * 100).toFixed(1)}% de tu portafolio`,
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
        message: `${(weight * 100).toFixed(1)}% de tu portafolio está en ${ASSET_TYPE_NAMES[type] ?? type}`,
        details: { asset_type: type, weight, threshold: 0.80 },
      })
    }
  }

  return alerts
}

/**
 * Replace a portfolio's standing concentration alerts with today's findings.
 *
 * Takes the portfolio explicitly and clears it even when there is nothing new
 * to insert. It used to derive the portfolios from the alerts and return early
 * on an empty list, so a concentration that had been fixed kept its warning on
 * screen: the one case with nothing to insert was the one that needed clearing.
 * Nothing called it until 4.5 wired it into the nightly job.
 */
export async function saveAlerts(
  supabase: SupabaseClient,
  portfolioId: string,
  alerts: ConcentrationAlert[],
): Promise<void> {
  await supabase
    .from('portfolio_alerts')
    .delete()
    .eq('portfolio_id', portfolioId)
    .eq('is_dismissed', false)

  if (alerts.length === 0) return

  // Two days, not one: the nightly job replaces them every day, and a run that
  // fails should not leave a real warning to vanish before the next one.
  await supabase.from('portfolio_alerts').insert(
    alerts.map((a) => ({
      ...a,
      expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
    }))
  )
}
