'use client'

import { createContext, useContext, useState, type ReactNode } from 'react'
import { convertCurrency, formatCurrency } from '@/lib/utils/currency'

type CurrencyContextType = {
  currency: string
  setCurrency: (c: string) => void
  format: (amount: number, from?: string) => string
  convert: (amount: number, from: string) => number
  rates: Record<string, number>
}

const CurrencyContext = createContext<CurrencyContextType | null>(null)

// Default rates — updated by Banxico worker
const DEFAULT_RATES: Record<string, number> = { USD: 1, MXN: 17.5, EUR: 0.92 }

export function CurrencyProvider({ children, initialCurrency = 'MXN' }: { children: ReactNode; initialCurrency?: string }) {
  const [currency, setCurrency] = useState(initialCurrency)
  const [rates] = useState(DEFAULT_RATES)

  const convert = (amount: number, from: string) => convertCurrency(amount, from, currency, rates)
  const format = (amount: number, from?: string) => {
    const converted = from ? convert(amount, from) : amount
    return formatCurrency(converted, currency)
  }

  return (
    <CurrencyContext.Provider value={{ currency, setCurrency, format, convert, rates }}>
      {children}
    </CurrencyContext.Provider>
  )
}

export function useCurrency() {
  const ctx = useContext(CurrencyContext)
  if (!ctx) throw new Error('useCurrency must be used within CurrencyProvider')
  return ctx
}
