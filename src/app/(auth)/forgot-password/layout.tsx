import type { Metadata } from 'next'

// The page is a client component and cannot export metadata.
export const metadata: Metadata = {
  title: 'Recuperar contraseña',
  description: 'Pide un enlace para elegir una contraseña nueva de tu cuenta de InvestTracker.',
}

export default function ForgotPasswordLayout({ children }: { children: React.ReactNode }) {
  return children
}
