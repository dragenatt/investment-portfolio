'use client'

import { createContext, useContext } from 'react'
import type { Dictionary, Locale } from './types'
import { defaultLocale } from './types'

type I18nContextValue = {
  locale: Locale
  t: Dictionary
}

const I18nContext = createContext<I18nContextValue | null>(null)

export function I18nProvider({ locale, dictionary, children }: { locale: Locale; dictionary: Dictionary; children: React.ReactNode }) {
  return (
    <I18nContext.Provider value={{ locale, t: dictionary }}>
      {children}
    </I18nContext.Provider>
  )
}

export function useTranslation(): I18nContextValue {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useTranslation must be used within I18nProvider')
  return ctx
}
