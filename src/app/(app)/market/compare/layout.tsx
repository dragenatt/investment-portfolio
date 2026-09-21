import type { Metadata } from 'next'

// The page is a client component and cannot export metadata; the root layout's
// template turns this into "Comparar activos · InvestTracker".
export const metadata: Metadata = { title: 'Comparar activos' }

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
