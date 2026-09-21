import type { Metadata } from 'next'

// The page is a client component and cannot export metadata.
export const metadata: Metadata = {
  title: 'Contraseña nueva',
  description: 'Elige una contraseña nueva para tu cuenta de InvestTracker.',
  // Reached from a one-time link; nothing here for a search engine.
  robots: { index: false },
}

export default function ResetPasswordLayout({ children }: { children: React.ReactNode }) {
  return children
}
