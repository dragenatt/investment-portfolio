import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { withAuditedCache } from '@/lib/cache/with-cache'
import { buildResultMetadata } from '@/lib/services/result-metadata'
import { apiHandler } from '@/lib/api/handler'
import { getBatchQuotes } from '@/lib/services/market'
import {
  sectorExposure,
  geographicExposure,
  currencyExposure,
  type ExposureHolding,
} from '@/lib/services/exposure'

/**
 * What the portfolio is actually bet on, as opposed to what it holds.
 *
 * A weights chart answers the second question. It cannot answer the first:
 * two ordinary 20% positions in the same sector are one 40% bet, and nothing
 * per-ticker makes that visible.
 */
async function getHandler(_req: Request, { params }: { params: Promise<{ pid: string }> }) {
  const { pid } = await params
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const data = await withAuditedCache(
    `analytics:exposure:${user.id}:${pid}`,
    900,
    async () => {
      const { data: portfolio } = await supabase
        .from('portfolios')
        .select('base_currency')
        .eq('id', pid)
        .single()

      const { data: positions } = await supabase
        .from('positions')
        .select('symbol, quantity, avg_cost, currency, asset_type')
        .eq('portfolio_id', pid)
        .gt('quantity', 0)

      if (!positions || positions.length === 0) return { message: 'No positions' }

      const symbols = positions.map((p) => p.symbol)

      const { data: companies } = await supabase
        .from('company_data')
        .select('symbol, sector, hq')
        .in('symbol', symbols)

      const sectorMap: Record<string, string | null> = {}
      const hqMap: Record<string, string | null> = {}
      for (const company of companies ?? []) {
        sectorMap[company.symbol] = company.sector ?? null
        hqMap[company.symbol] = company.hq ?? null
      }

      const priceMap: Record<string, number> = {}
      try {
        const quotes = await getBatchQuotes(symbols)
        for (const [symbol, quote] of Object.entries(quotes)) {
          if (quote.price != null) priceMap[symbol] = quote.price
        }
      } catch {
        // Average cost stands in when a quote cannot be had; the relative
        // weights are what this endpoint is about, not the absolute values.
      }

      const holdings: ExposureHolding[] = positions.map((position) => ({
        symbol: position.symbol,
        value: position.quantity * (priceMap[position.symbol] ?? position.avg_cost),
        // Falls back to the asset type, so a bond ETF lands somewhere sensible
        // rather than in Unknown alongside genuinely unclassified holdings.
        sector:
          sectorMap[position.symbol] ??
          (position.asset_type
            ? position.asset_type.charAt(0).toUpperCase() + position.asset_type.slice(1)
            : null),
        currency: position.currency ?? 'USD',
        country: hqMap[position.symbol] ?? null,
      }))

      const baseCurrency = portfolio?.base_currency ?? 'MXN'

      return {
        base_currency: baseCurrency,
        sector: sectorExposure(holdings),
        geographic: geographicExposure(holdings),
        currency: currencyExposure(holdings, baseCurrency),
        _meta: buildResultMetadata({
          model: 'exposure',
          data: {
            description: 'Posiciones actuales a su cotización más reciente; sector y país de los datos de empresas',
            symbols,
            excluded: symbols.filter((s) => priceMap[s] === undefined),
            priceSource: 'provider',
          },
          assumptions: [
            { name: 'Región', value: 'País de la empresa; si falta, bolsa donde cotiza o moneda', source: 'exposure.ts (inferRegion)' },
            { name: 'Concentración sectorial', value: '35% del portafolio', source: 'exposure.ts' },
            { name: 'Sin cotización', value: 'Se usa el costo promedio', source: 'exposure route' },
          ],
        }),
      }
    }
  )

  return success(data)
}

export const GET = apiHandler(getHandler)
