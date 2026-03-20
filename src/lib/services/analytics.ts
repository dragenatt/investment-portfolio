export function calculateVolatility(returns: number[]): number {
  if (returns.length < 2) return 0
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length
  const squaredDiffs = returns.map(r => Math.pow(r - mean, 2))
  const variance = squaredDiffs.reduce((a, b) => a + b, 0) / (returns.length - 1)
  return Math.sqrt(variance) * Math.sqrt(252) // Annualized
}

export function calculateSharpeRatio(returns: number[], riskFreeRate: number): number {
  if (returns.length < 2) return 0
  const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length
  const annualizedReturn = meanReturn * 252
  const volatility = calculateVolatility(returns)
  if (volatility === 0) return 0
  return (annualizedReturn - riskFreeRate) / volatility
}

export function calculateMaxDrawdown(values: number[]): number {
  if (values.length < 2) return 0
  let maxDrawdown = 0
  let peak = values[0]
  for (const value of values) {
    if (value > peak) peak = value
    const drawdown = (peak - value) / peak
    if (drawdown > maxDrawdown) maxDrawdown = drawdown
  }
  return maxDrawdown * 100 // As percentage
}

export function calculateDailyReturns(closes: number[]): number[] {
  const returns: number[] = []
  for (let i = 1; i < closes.length; i++) {
    returns.push((closes[i] - closes[i - 1]) / closes[i - 1])
  }
  return returns
}
