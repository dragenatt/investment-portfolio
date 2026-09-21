import type { Metadata } from 'next'

// The page is a client component and cannot export metadata; the root layout's
// template turns this into "Portafolio · InvestTracker".
export const metadata: Metadata = { title: 'Portafolio' }

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
