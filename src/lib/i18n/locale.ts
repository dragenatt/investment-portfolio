import 'server-only'
import { cookies } from 'next/headers'
import type { Locale } from './types'
import { defaultLocale, locales } from './types'

const LOCALE_COOKIE = 'NEXT_LOCALE'

export async function getLocaleFromCookies(): Promise<Locale> {
  const cookieStore = await cookies()
  const val = cookieStore.get(LOCALE_COOKIE)?.value
  if (val && locales.includes(val as Locale)) return val as Locale
  return defaultLocale
}
