import type { Locale } from './types'

const LOCALE_COOKIE = 'NEXT_LOCALE'

export function setLocaleCookie(locale: Locale) {
  document.cookie = `${LOCALE_COOKIE}=${locale};path=/;max-age=${60 * 60 * 24 * 365};samesite=lax`
}
