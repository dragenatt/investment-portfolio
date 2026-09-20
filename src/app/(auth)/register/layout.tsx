import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Crear cuenta',
  description: 'Crea tu cuenta de InvestTracker y empieza a seguir tus inversiones.',
}

export default function RegisterLayout({ children }: { children: React.ReactNode }) {
  return children
}
