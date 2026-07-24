'use client'

import { CurrencyProvider as CP } from '@/lib/hooks/use-currency'

export function CurrencyProvider({ children, initialCurrency = 'MXN' }: { children: React.ReactNode; initialCurrency?: string }) {
  return <CP initialCurrency={initialCurrency}>{children}</CP>
}
