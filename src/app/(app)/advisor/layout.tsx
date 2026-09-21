import type { Metadata } from 'next'

// The page is a client component and cannot export metadata; the root layout's
// template turns this into "Asesor de inversión · InvestTracker".
export const metadata: Metadata = { title: 'Asesor de inversión' }

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
