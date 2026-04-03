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
        shouldRetryOnError: (err: Error) => {
          // Don't retry on auth errors or client errors
          const msg = err?.message || ''
          if (msg.includes('401') || msg.includes('403') || msg.includes('Unauthorized')) return false
          return true
        },
        errorRetryInterval: 3000,
      }}
    >
      {children}
    </SWRConfig>
  )
}
