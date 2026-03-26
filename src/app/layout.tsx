import type { Metadata } from 'next'
import { Plus_Jakarta_Sans, JetBrains_Mono, Fraunces } from 'next/font/google'
import { ThemeProvider } from '@/providers/theme-provider'
import { Toaster } from '@/components/ui/sonner'
import './globals.css'

const plusJakarta = Plus_Jakarta_Sans({ subsets: ['latin'], variable: '--font-sans' })
const fraunces = Fraunces({ subsets: ['latin'], variable: '--font-serif' })
const jetbrains = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono' })

export const metadata: Metadata = {
  title: 'InvestTracker — Tu Portafolio de Inversión',
  description: 'Plataforma profesional para trackear y analizar tus inversiones en tiempo real.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body className={`${plusJakarta.variable} ${fraunces.variable} ${jetbrains.variable} font-sans antialiased`}>
        <ThemeProvider>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  )
}
