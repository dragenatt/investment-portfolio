// Technical analysis indicator calculations — pure functions, no dependencies

/** Simple Moving Average */
export function calculateSMA(data: number[], period: number): (number | null)[] {
  return data.map((_, i) => {
    if (i < period - 1) return null
    const slice = data.slice(i - period + 1, i + 1)
    return slice.reduce((a, b) => a + b, 0) / period
  })
}

/** Exponential Moving Average */
export function calculateEMA(data: number[], period: number): (number | null)[] {
  const k = 2 / (period + 1)
  const result: (number | null)[] = []
  let ema: number | null = null
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(null)
      continue
    }
    if (ema === null) {
      ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period
    } else {
      ema = data[i] * k + ema * (1 - k)
    }
    result.push(ema)
  }
  return result
}

/** Relative Strength Index */
export function calculateRSI(data: number[], period: number = 14): (number | null)[] {
  const result: (number | null)[] = []
  if (data.length < period + 1) {
    return data.map(() => null)
  }

  // Calculate price changes
  const changes: number[] = []
  for (let i = 1; i < data.length; i++) {
    changes.push(data[i] - data[i - 1])
  }

  // First average gain/loss using SMA
  let avgGain = 0
  let avgLoss = 0
  for (let i = 0; i < period; i++) {
    if (changes[i] >= 0) avgGain += changes[i]
    else avgLoss += Math.abs(changes[i])
  }
  avgGain /= period
  avgLoss /= period

  // First data point has no change, and the first `period` changes need period+1 data points
  result.push(null) // index 0 — no prior price to compare
  for (let i = 0; i < period - 1; i++) {
    result.push(null)
  }
  // RSI at index = period
  const rs = avgLoss === 0 ? 100 : avgGain / avgLoss
  result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + rs))

  // Remaining values using smoothed averages
  for (let i = period; i < changes.length; i++) {
    const change = changes[i]
    const gain = change >= 0 ? change : 0
    const loss = change < 0 ? Math.abs(change) : 0
    avgGain = (avgGain * (period - 1) + gain) / period
    avgLoss = (avgLoss * (period - 1) + loss) / period
    const rsi = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
    result.push(rsi)
  }

  return result
}

/** Bollinger Bands */
export function calculateBollingerBands(
  data: number[],
  period: number = 20,
  stdDevMultiplier: number = 2,
): {
  upper: (number | null)[]
  middle: (number | null)[]
  lower: (number | null)[]
} {
  const middle = calculateSMA(data, period)
  const upper: (number | null)[] = []
  const lower: (number | null)[] = []

  for (let i = 0; i < data.length; i++) {
    const m = middle[i]
    if (m === null) {
      upper.push(null)
      lower.push(null)
      continue
    }
    const slice = data.slice(i - period + 1, i + 1)
    const variance = slice.reduce((sum, val) => sum + (val - m) ** 2, 0) / period
    const stdDev = Math.sqrt(variance)
    upper.push(m + stdDevMultiplier * stdDev)
    lower.push(m - stdDevMultiplier * stdDev)
  }

  return { upper, middle, lower }
}
