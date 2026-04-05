'use client'

import { useMemo } from 'react'
import { useCurrency } from '@/lib/hooks/use-currency'

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
  const { convert, currency: displayCurrency } = useCurrency()

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
        isLoading: true,
      }
    }

    let totalValue = 0
    let totalCost = 0
    let positionCount = 0
    const allocationMap: Record<string, number> = {}
    const movers: Mover[] = []
    let todayReturn = 0

    for (const portfolio of portfolios) {
      for (const pos of portfolio.positions || []) {
        if (pos.quantity > 0) {
          const liveData = livePrices?.[pos.symbol]
          const priceCurrency = liveData?.currency || pos.currency || 'USD'
          const costCurrency = pos.currency || 'USD'

          const livePrice = liveData?.price ?? pos.avg_cost
          const livePriceInDisplay = liveData
            ? convert(livePrice, priceCurrency)
            : convert(livePrice, costCurrency)
          const value = pos.quantity * livePriceInDisplay

          const avgCostInDisplay = convert(pos.avg_cost, costCurrency)
          const cost = pos.quantity * avgCostInDisplay

          totalValue += value
          totalCost += cost
          positionCount++
          allocationMap[pos.asset_type] = (allocationMap[pos.asset_type] || 0) + value

          if (liveData) {
            const change = liveData.change ?? 0
            const changePct = liveData.changePct ?? 0
            const changeInDisplay = convert(change, priceCurrency)
            todayReturn += pos.quantity * changeInDisplay
            movers.push({
              symbol: pos.symbol,
              name: liveData.name || pos.symbol,
              price: livePriceInDisplay,
              change: changeInDisplay,
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
      isLoading: false,
    }
  }, [portfolios, livePrices, convert, displayCurrency])
}
