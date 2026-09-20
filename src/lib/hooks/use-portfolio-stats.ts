'use client'

import { useMemo } from 'react'
import { useCurrency } from '@/lib/hooks/use-currency'
import { dailyChangeFromPct } from '@/lib/services/pnl'

type Mover = {
  symbol: string
  name: string
  price: number
  change: number
  changePct: number
  currency: string
}

type AllocationEntry = { name: string; value: number }

type Position = {
  symbol: string
  quantity: number
  avg_cost: number
  currency?: string
  asset_type: string
}

type Portfolio = {
  positions?: Position[]
}

type LivePrice = {
  price?: number
  change?: number
  changePct?: number
  currency?: string
  name?: string
}

type PortfolioStats = {
  totalValue: number
  totalCost: number
  totalReturn: number
  totalReturnPct: number
  positionCount: number
  allocation: AllocationEntry[]
  topMovers: Mover[]
  bestPosition?: { symbol: string; changePct: number }
  todayReturn?: number
  todayReturnPct?: number
  /**
   * Currencies in this total that no rate reaches, so their amounts are in
   * the total as they came — a yen figure counted as pesos. Empty is the
   * normal case; anything in it has to be said on the screen, because the
   * number alone cannot be told apart from a correct one.
   */
  unconverted: string[]
  isLoading: boolean
}

/**
 * Computes aggregate portfolio statistics from raw portfolio and live price data.
 * Handles currency conversion, allocation breakdown, top movers, and return calculations.
 */
export function usePortfolioStats(
  portfolios: Portfolio[] | undefined,
  livePrices: Record<string, LivePrice> | undefined
): PortfolioStats {
  const { convert, canConvert, currency: displayCurrency } = useCurrency()

  return useMemo(() => {
    if (!portfolios) {
      return {
        totalValue: 0,
        totalCost: 0,
        totalReturn: 0,
        totalReturnPct: 0,
        positionCount: 0,
        allocation: [],
        topMovers: [],
        bestPosition: undefined,
        todayReturn: undefined,
        todayReturnPct: undefined,
        unconverted: [],
        isLoading: true,
      }
    }

    let totalValue = 0
    let totalCost = 0
    let positionCount = 0
    const allocationMap: Record<string, number> = {}
    const movers: Mover[] = []
    const unconverted = new Set<string>()
    let todayReturn = 0

    for (const portfolio of portfolios) {
      for (const pos of portfolio.positions || []) {
        if (pos.quantity > 0) {
          const liveData = livePrices?.[pos.symbol]
          const priceCurrency = liveData?.currency || pos.currency || 'USD'
          const costCurrency = pos.currency || 'USD'

          const livePrice = liveData?.price ?? pos.avg_cost
          const valueCurrency = liveData ? priceCurrency : costCurrency
          // Both halves of this position's contribution have to reach the
          // display currency: the price that makes its value and the cost that
          // makes its return. Either one failing puts a foreign figure in the
          // total, so both are asked about.
          for (const unit of [valueCurrency, costCurrency]) {
            if (!canConvert(unit)) unconverted.add(unit)
          }
          const livePriceInDisplay = convert(livePrice, valueCurrency)
          const value = pos.quantity * livePriceInDisplay

          const avgCostInDisplay = convert(pos.avg_cost, costCurrency)
          const cost = pos.quantity * avgCostInDisplay

          totalValue += value
          totalCost += cost
          positionCount++
          allocationMap[pos.asset_type] = (allocationMap[pos.asset_type] || 0) + value

          if (liveData) {
            const changePct = liveData.changePct ?? 0
            // Daily change is derived from the percentage move and today's value
            // (already in the display currency). This is more reliable than the
            // provider's absolute `change`, which is frequently null even when
            // the percentage is present. The percentage is against yesterday's
            // close, so dailyChangeFromPct takes it off yesterday's value, not
            // today's — the same helper the portfolio detail page uses.
            const dayChangeDisplay = dailyChangeFromPct(value, changePct)
            todayReturn += dayChangeDisplay
            movers.push({
              symbol: pos.symbol,
              name: liveData.name || pos.symbol,
              price: livePriceInDisplay,
              change: pos.quantity > 0 ? dayChangeDisplay / pos.quantity : 0,
              changePct,
              currency: displayCurrency,
            })
          }
        }
      }
    }

    const totalReturn = totalValue - totalCost
    const totalReturnPct = totalCost > 0 ? (totalReturn / totalCost) * 100 : 0
    const yesterdayValue = totalValue - todayReturn
    const todayReturnPct = yesterdayValue > 0 ? (todayReturn / yesterdayValue) * 100 : 0

    const allocation = Object.entries(allocationMap).map(([name, value]) => ({ name, value }))
    const sortedMovers = [...movers].sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))
    const topMovers = sortedMovers.slice(0, 5)

    const bestGainer = [...movers].sort((a, b) => b.changePct - a.changePct)[0]
    const bestPosition = bestGainer && bestGainer.changePct !== 0
      ? { symbol: bestGainer.symbol, changePct: bestGainer.changePct }
      : undefined

    const hasPrices = movers.length > 0

    return {
      totalValue,
      totalCost,
      totalReturn,
      totalReturnPct,
      positionCount,
      allocation,
      topMovers,
      bestPosition,
      todayReturn: hasPrices ? todayReturn : undefined,
      todayReturnPct: hasPrices ? todayReturnPct : undefined,
      unconverted: [...unconverted].sort(),
      isLoading: false,
    }
    // `convert` and `canConvert` are rebuilt on every render of the provider;
    // the display currency and the rates behind them are what actually change
    // an answer, and the rates arrive with the prices.
  }, [portfolios, livePrices, convert, canConvert, displayCurrency])
}
