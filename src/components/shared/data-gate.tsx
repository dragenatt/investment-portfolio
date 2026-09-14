'use client'

import type { ReactNode } from 'react'
import { ErrorDisplay } from '@/components/shared/error-display'

/**
 * A failed load is not an empty result (C9).
 *
 * Financial components receive `data ?? 0` or `data ?? []` and render what they
 * get, so when a request failed they showed a 0.00% return, "no hay datos
 * suficientes" or "sin transacciones" — statements about the portfolio that
 * were not true. DataGate shows the failure instead, with a retry, and only
 * when there is no earlier data to keep showing.
 */
export function DataGate({
  error,
  hasData,
  what,
  onRetry,
  children,
}: {
  error: unknown
  hasData: boolean
  /** "los rendimientos", "el análisis de riesgo"… */
  what: string
  onRetry?: () => void
  children: ReactNode
}) {
  if (error && !hasData) {
    return (
      <ErrorDisplay
        error={`No se pudo cargar ${what}. Tus datos no se han perdido; vuelve a intentarlo.`}
        onRetry={onRetry ?? (() => window.location.reload())}
      />
    )
  }
  return <>{children}</>
}
