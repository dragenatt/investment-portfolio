import type { Metadata } from 'next'

// The page is a client component and cannot export metadata; the root layout's
// template turns this into "Panel de control · InvestTracker".
export const metadata: Metadata = { title: 'Panel de control' }

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
