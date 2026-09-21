import type { Metadata } from 'next'

// The page is a client component and cannot export metadata; the root layout's
// template turns this into "Nuevo portafolio · InvestTracker".
export const metadata: Metadata = { title: 'Nuevo portafolio' }

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
