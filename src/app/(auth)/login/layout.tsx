import type { Metadata } from 'next'

// The page itself is a client component and cannot export metadata, so it
// lives here — the layout Next renders around it.
export const metadata: Metadata = {
  title: 'Iniciar sesión',
  description: 'Entra a InvestTracker para ver y analizar tu portafolio de inversiones.',
}

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children
}
