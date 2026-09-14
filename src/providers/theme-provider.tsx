'use client'

import { ThemeProvider as NextThemesProvider } from 'next-themes'
import { type ReactNode } from 'react'

// next-themes writes an inline script to set the theme before paint; under the
// CSP (C6) it runs only with the request's nonce.
export function ThemeProvider({ children, nonce }: { children: ReactNode; nonce?: string }) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange nonce={nonce}>
      {children}
    </NextThemesProvider>
  )
}
