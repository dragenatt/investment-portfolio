type HistoryTransaction = {
  executed_at: string
  type: 'buy' | 'sell' | 'dividend' | 'split'
  symbol: string
  quantity: number
  price: number
}

type DailySnapshot = {
  date: string // YYYY-MM-DD
  positions: Record<string, number> // symbol -> quantity
}

export function computeDailyPositions(transactions: HistoryTransaction[]): DailySnapshot[] {
  if (transactions.length === 0) return []

  const sorted = [...transactions].sort(
    (a, b) => new Date(a.executed_at).getTime() - new Date(b.executed_at).getTime()
  )

  const snapshots: DailySnapshot[] = []
  const currentPositions: Record<string, number> = {}

  for (const txn of sorted) {
    const date = txn.executed_at.slice(0, 10)

    switch (txn.type) {
      case 'buy':
        currentPositions[txn.symbol] = (currentPositions[txn.symbol] || 0) + txn.quantity
        break
      case 'sell':
        currentPositions[txn.symbol] = Math.max(0, (currentPositions[txn.symbol] || 0) - txn.quantity)
        break
      case 'split':
        currentPositions[txn.symbol] = (currentPositions[txn.symbol] || 0) * txn.quantity
        break
      case 'dividend':
        break
    }

    const existing = snapshots.find(s => s.date === date)
    if (existing) {
      existing.positions = { ...currentPositions }
    } else {
      snapshots.push({ date, positions: { ...currentPositions } })
    }
  }

  return snapshots
}

export function buildDailyTimeline(
  snapshots: DailySnapshot[],
  historicalPrices: Record<string, Record<string, number>>,
  endDate: string,
  transactionPrices?: Record<string, number>
): Array<{ date: string; value: number }> {
  if (snapshots.length === 0) return []

  const startDate = snapshots[0].date
  const timeline: Array<{ date: string; value: number }> = []
  let currentPositions: Record<string, number> = {}
  const lastGoodPrice: Record<string, number> = {}

  const start = new Date(startDate)
  const end = new Date(endDate)

  let snapshotIdx = 0
  const current = new Date(start)

  while (current <= end) {
    const dateStr = current.toISOString().slice(0, 10)

    while (snapshotIdx < snapshots.length && snapshots[snapshotIdx].date <= dateStr) {
      currentPositions = { ...snapshots[snapshotIdx].positions }
      snapshotIdx++
    }

    let value = 0
    for (const [symbol, quantity] of Object.entries(currentPositions)) {
      if (quantity <= 0) continue
      const symbolPrices = historicalPrices[symbol] || {}
      let price = symbolPrices[dateStr] ?? findLastKnownPrice(symbolPrices, dateStr)
      if (!price && lastGoodPrice[symbol]) {
        price = lastGoodPrice[symbol]
      }
      if (!price && transactionPrices?.[symbol]) {
        price = transactionPrices[symbol]
      }
      if (price) lastGoodPrice[symbol] = price
      value += quantity * (price || 0)
    }

    timeline.push({ date: dateStr, value })
    current.setDate(current.getDate() + 1)
  }

  return timeline
}

function findLastKnownPrice(prices: Record<string, number>, targetDate: string): number {
  const dates = Object.keys(prices).filter(d => d <= targetDate).sort()
  return dates.length > 0 ? prices[dates[dates.length - 1]] : 0
}
