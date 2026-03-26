'use client'

import { SWRConfig } from 'swr'
import { apiFetcher } from '@/lib/api/fetcher'
import type { ReactNode } from 'react'

export function SWRConfigProvider({ children }: { children: ReactNode }) {
  return (
    <SWRConfig
      value={{
        fetcher: apiFetcher,
        dedupingInterval: 5000,
        revalidateOnFocus: true,
        errorRetryCount: 3,
        shouldRetryOnError: true,
      }}
    >
      {children}
    </SWRConfig>
  )
}
