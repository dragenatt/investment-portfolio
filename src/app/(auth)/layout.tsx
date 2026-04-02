import { I18nProvider, getDictionary } from '@/lib/i18n'
import { getLocaleFromCookies } from '@/lib/i18n/locale'

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocaleFromCookies()
  const dictionary = await getDictionary(locale)

  return (
    <I18nProvider locale={locale} dictionary={dictionary}>
      {children}
    </I18nProvider>
  )
}
