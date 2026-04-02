import 'server-only'
import type { Locale, Dictionary } from './types'

const dictionaries: Record<string, () => Promise<Dictionary>> = {
  es: () => import('@/app/dictionaries/es.json').then(m => m.default),
  en: () => import('@/app/dictionaries/en.json').then(m => m.default),
}

export async function getDictionary(locale: Locale): Promise<Dictionary> {
  return dictionaries[locale]()
}
