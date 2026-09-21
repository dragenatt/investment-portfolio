import type { Metadata } from 'next'

// The page is a client component and cannot export metadata; the root layout's
// template turns this into "Privacidad · InvestTracker".
export const metadata: Metadata = { title: 'Privacidad' }

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
