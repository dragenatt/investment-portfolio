import type { Metadata, Viewport } from 'next'
import { headers } from 'next/headers'
import { Plus_Jakarta_Sans, JetBrains_Mono, Fraunces } from 'next/font/google'
import { ThemeProvider } from '@/providers/theme-provider'
import { Toaster } from '@/components/ui/sonner'
import { getLocaleFromCookies } from '@/lib/i18n/locale'
import './globals.css'
import { WebVitalsReporter } from '@/components/analytics/web-vitals-reporter'
import { ServiceWorkerRegistration } from '@/components/pwa/service-worker-registration'
import { isEnabled } from '@/lib/services/feature-flags'

const plusJakarta = Plus_Jakarta_Sans({ subsets: ['latin'], variable: '--font-sans' })
const fraunces = Fraunces({ subsets: ['latin'], variable: '--font-serif' })
const jetbrains = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono' })

export const metadata: Metadata = {
  // Every page shared one title and one description: a search result, a
  // bookmark and a browser tab all said "InvestTracker — Tu Portafolio de
  // Inversión", whichever page you were on. `default` keeps that for the
  // landing page; `template` lets a page say what it is.
  title: {
    default: 'InvestTracker — Tu Portafolio de Inversión',
    template: '%s · InvestTracker',
  },
  description: 'Plataforma profesional para trackear y analizar tus inversiones en tiempo real.',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'InvestTracker',
  },
  openGraph: {
    type: 'website',
    locale: 'es_ES',
    url: 'https://project-tri0w.vercel.app',
    siteName: 'InvestTracker',
    title: 'InvestTracker — Tu Portafolio de Inversión',
    description: 'Plataforma profesional para trackear y analizar tus inversiones en tiempo real.',
    images: [
      {
        url: 'https://project-tri0w.vercel.app/icons/icon-512.png',
        width: 512,
        height: 512,
        alt: 'InvestTracker Logo',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'InvestTracker — Tu Portafolio de Inversión',
    description: 'Plataforma profesional para trackear y analizar tus inversiones en tiempo real.',
    images: ['https://project-tri0w.vercel.app/icons/icon-512.png'],
  },
}

export const viewport: Viewport = {
  // The browser chrome follows the page (D10): paper in light mode, ink in dark.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F4F3EE' },
    { media: '(prefers-color-scheme: dark)', color: '#0A0F14' },
  ],
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocaleFromCookies()
  const nonce = (await headers()).get('x-nonce') ?? undefined

  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <link rel="icon" href="/icons/icon-192.png" sizes="192x192" type="image/png" />
        <link rel="icon" href="/icons/icon-512.png" sizes="512x512" type="image/png" />
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" sizes="180x180" />
        <link rel="manifest" href="/manifest.json" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="InvestTracker" />
      </head>
      <body className={`${plusJakarta.variable} ${fraunces.variable} ${jetbrains.variable} font-sans antialiased`}>
        <ThemeProvider nonce={nonce}>
          {children}
          <Toaster />
        </ThemeProvider>
        <WebVitalsReporter />
        <ServiceWorkerRegistration enabled={isEnabled('pwa')} />
      </body>
    </html>
  )
}
