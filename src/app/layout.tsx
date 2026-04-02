import type { Metadata, Viewport } from 'next'
import { Plus_Jakarta_Sans, JetBrains_Mono, Fraunces } from 'next/font/google'
import { ThemeProvider } from '@/providers/theme-provider'
import { Toaster } from '@/components/ui/sonner'
import { getLocaleFromCookies } from '@/lib/i18n/locale'
import './globals.css'

const plusJakarta = Plus_Jakarta_Sans({ subsets: ['latin'], variable: '--font-sans' })
const fraunces = Fraunces({ subsets: ['latin'], variable: '--font-serif' })
const jetbrains = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono' })

export const metadata: Metadata = {
  title: 'InvestTracker — Tu Portafolio de Inversión',
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
  themeColor: '#09090b',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocaleFromCookies()

  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <link rel="icon" href="/icons/icon-192.png" sizes="192x192" type="image/png" />
        <link rel="icon" href="/icons/icon-512.png" sizes="512x512" type="image/png" />
        <link rel="apple-touch-icon" href="/icons/icon-192.png" />
        <link rel="manifest" href="/manifest.json" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="InvestTracker" />
      </head>
      <body className={`${plusJakarta.variable} ${fraunces.variable} ${jetbrains.variable} font-sans antialiased`}>
        <ThemeProvider>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  )
}
