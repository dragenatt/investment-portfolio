import type { Metadata } from 'next'
import { sectionTitle } from '@/lib/metadata'

// The page is a client component and cannot export metadata. sectionTitle
// keeps the " · InvestTracker" template for the pages below this one.
export const metadata: Metadata = { title: sectionTitle('Watchlist') }

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
