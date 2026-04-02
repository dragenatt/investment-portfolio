import type esDict from '@/app/dictionaries/es.json'

export type Locale = 'es' | 'en'
export type Dictionary = typeof esDict
export const defaultLocale: Locale = 'es'
export const locales: Locale[] = ['es', 'en']
