import type { Metadata } from 'next'

// The page is a client component and cannot export metadata; the root layout's
// template turns this into "Portafolios · InvestTracker".
export const metadata: Metadata = { title: 'Portafolios' }

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
