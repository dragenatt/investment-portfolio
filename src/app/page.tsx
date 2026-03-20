import { Button } from '@/components/ui/button'
import Link from 'next/link'
import { TrendingUp, PieChart, Zap } from 'lucide-react'

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Nav */}
      <nav className="flex items-center justify-between px-6 py-4 border-b">
        <span className="font-bold text-xl">InvestTracker</span>
        <div className="flex gap-3">
          <Link href="/login"><Button variant="ghost">Iniciar Sesion</Button></Link>
          <Link href="/register"><Button>Crear Cuenta</Button></Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="max-w-4xl mx-auto text-center py-20 px-6">
        <h1 className="text-4xl md:text-6xl font-bold tracking-tight mb-6">
          Tu portafolio de inversion,<br />
          <span className="text-primary">profesional y en tiempo real</span>
        </h1>
        <p className="text-lg text-muted-foreground mb-8 max-w-2xl mx-auto">
          Trackea acciones, ETFs, crypto, CETES, forex y commodities en una sola plataforma.
          Analytics avanzados, multi-moneda, y diseno que te da control total.
        </p>
        <Link href="/register">
          <Button size="lg" className="text-lg px-8 py-6">
            Crea tu cuenta gratis
          </Button>
        </Link>
      </section>

      {/* Features */}
      <section className="max-w-5xl mx-auto px-6 pb-20">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="text-center p-6">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-lg bg-primary/10 mb-4">
              <TrendingUp className="h-6 w-6 text-primary" />
            </div>
            <h3 className="font-semibold text-lg mb-2">Multi-Activo</h3>
            <p className="text-sm text-muted-foreground">
              Acciones, ETFs, crypto, CETES, bonos, forex y commodities. Todo en un solo dashboard.
            </p>
          </div>
          <div className="text-center p-6">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-lg bg-primary/10 mb-4">
              <PieChart className="h-6 w-6 text-primary" />
            </div>
            <h3 className="font-semibold text-lg mb-2">Analytics Avanzados</h3>
            <p className="text-sm text-muted-foreground">
              Rendimiento, distribucion, riesgo, correlaciones y comparacion con benchmarks.
            </p>
          </div>
          <div className="text-center p-6">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-lg bg-primary/10 mb-4">
              <Zap className="h-6 w-6 text-primary" />
            </div>
            <h3 className="font-semibold text-lg mb-2">Datos en Tiempo Real</h3>
            <p className="text-sm text-muted-foreground">
              Precios actualizados desde multiples fuentes. Multi-moneda con tipos de cambio de Banxico.
            </p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t py-8 text-center text-sm text-muted-foreground">
        <p>InvestTracker -- Hecho con Next.js, Supabase y Cloudflare</p>
      </footer>
    </div>
  )
}
