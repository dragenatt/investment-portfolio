import type { Metadata } from 'next'

// The page is a client component and cannot export metadata; the root layout's
// template turns this into "Portafolio público · InvestTracker".
export const metadata: Metadata = { title: 'Portafolio público' }

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
