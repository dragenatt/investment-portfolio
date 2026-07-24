'use client'

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import useSWR from 'swr'
import { convertCurrency, formatCurrency } from '@/lib/utils/currency'
import { useRates } from '@/lib/hooks/use-rates'
import { apiFetcher } from '@/lib/api/fetcher'

type CurrencyContextType = {
  currency: string
  setCurrency: (c: string) => void
  format: (amount: number, from?: string) => string
  convert: (amount: number, from: string) => number
  rates: Record<string, number>
}

const CurrencyContext = createContext<CurrencyContextType | null>(null)

const FALLBACK_RATES: Record<string, number> = { USD: 1, MXN: 17.5, EUR: 0.92 }

export function CurrencyProvider({ children, initialCurrency = 'MXN' }: { children: ReactNode; initialCurrency?: string }) {
  const [currency, setCurrencyState] = useState(initialCurrency)
  const { data: rates } = useRates()
  const activeRates = rates ?? FALLBACK_RATES

  // The display currency is the user's saved `base_currency` preference. We seed
  // it from the server (initialCurrency) to avoid a flash, then keep it in sync
  // with the profile so a change in Settings takes effect app-wide.
  const { data: profile, mutate: mutateProfile } = useSWR<{ base_currency?: string }>(
    '/api/user/profile',
    apiFetcher,
    { fallbackData: { base_currency: initialCurrency }, revalidateOnFocus: false }
  )
  const savedCurrency = profile?.base_currency
  useEffect(() => {
    if (savedCurrency && savedCurrency !== currency) setCurrencyState(savedCurrency)
    // Only react to the saved preference changing, not local edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedCurrency])

  // Changing the currency updates the UI immediately and persists it so the
  // choice survives reloads and stays consistent everywhere.
  const setCurrency = useCallback((c: string) => {
    setCurrencyState(c)
    mutateProfile((prev) => ({ ...(prev ?? {}), base_currency: c }), { revalidate: false })
    fetch('/api/user/preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base_currency: c }),
    }).catch(() => { /* best-effort; UI already reflects the change */ })
  }, [mutateProfile])

  const convert = (amount: number, from: string) => convertCurrency(amount, from, currency, activeRates)
  const format = (amount: number, from?: string) => {
    const converted = from ? convert(amount, from) : amount
    return formatCurrency(converted, currency)
  }

  return (
    <CurrencyContext.Provider value={{ currency, setCurrency, format, convert, rates: activeRates }}>
      {children}
    </CurrencyContext.Provider>
  )
}

export function useCurrency() {
  const ctx = useContext(CurrencyContext)
  if (!ctx) throw new Error('useCurrency must be used within CurrencyProvider')
  return ctx
}
