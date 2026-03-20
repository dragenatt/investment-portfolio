'use client'

import { CurrencyProvider as CP } from '@/lib/hooks/use-currency'

export function CurrencyProvider({ children }: { children: React.ReactNode }) {
  return <CP initialCurrency="MXN">{children}</CP>
}
