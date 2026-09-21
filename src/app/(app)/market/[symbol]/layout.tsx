import type { Metadata } from 'next'

type Props = {
  params: Promise<{ symbol: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { symbol } = await params
  const decodedSymbol = decodeURIComponent(symbol)

  return {
    // The root layout's template adds " · InvestTracker"; the brand here would
    // have read "VOO — InvestTracker · InvestTracker" in the tab. Open Graph and
    // Twitter titles are not templated, so they keep it.
    title: decodedSymbol,
    description: `Cotización en tiempo real de ${decodedSymbol}, gráficas históricas y análisis fundamental.`,
    openGraph: {
      type: 'website',
      locale: 'es_ES',
      url: `https://project-tri0w.vercel.app/market/${symbol}`,
      title: `${decodedSymbol} — InvestTracker`,
      description: `Cotización en tiempo real de ${decodedSymbol}, gráficas históricas y análisis fundamental.`,
      siteName: 'InvestTracker',
      images: [
        {
          url: 'https://project-tri0w.vercel.app/icons/icon-512.png',
          width: 512,
          height: 512,
          alt: `${decodedSymbol} - InvestTracker`,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: `${decodedSymbol} — InvestTracker`,
      description: `Cotización en tiempo real de ${decodedSymbol}, gráficas históricas y análisis fundamental.`,
      images: ['https://project-tri0w.vercel.app/icons/icon-512.png'],
    },
  }
}

export default function SymbolLayout({ children }: { children: React.ReactNode }) {
  return children
}
