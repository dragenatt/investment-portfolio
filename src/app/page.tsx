import { Button } from '@/components/ui/button'
import Link from 'next/link'
import { TrendingUp, BarChart3, Bell, Globe, FileSpreadsheet } from 'lucide-react'

const features = [
  {
    icon: TrendingUp,
    title: 'Mercados en Vivo',
    description: 'Precios actualizados de NYSE, NASDAQ y BMV con graficos interactivos.',
  },
  {
    icon: BarChart3,
    title: 'Analisis Inteligente',
    description: 'Rendimiento historico, distribucion de activos, riesgo y benchmarks.',
  },
  {
    icon: Bell,
    title: 'Alertas Personalizadas',
    description: 'Recibe notificaciones cuando tus activos alcanzan el precio objetivo.',
  },
  {
    icon: Globe,
    title: 'Multi-Moneda',
    description: 'Opera en MXN, USD y EUR con tipos de cambio en tiempo real.',
  },
]

export default function LandingPage() {
  return (
    <div className="min-h-screen" style={{ background: 'linear-gradient(180deg, var(--gradient-hero-start) 0%, var(--gradient-hero-end) 50%, var(--background) 100%)' }}>
      {/* Nav */}
      <nav className="flex items-center justify-between px-6 py-4 max-w-6xl mx-auto">
        <span className="font-bold text-xl text-foreground">InvestTracker</span>
        <div className="flex gap-3">
          <Link href="/login">
            <Button variant="ghost" className="text-foreground/70 hover:text-foreground hover:bg-secondary">
              Iniciar sesion
            </Button>
          </Link>
          <Link href="/register">
            <Button className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-xl">
              Registrarse
            </Button>
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="max-w-4xl mx-auto text-center pt-16 pb-12 px-6">
        <h1 className="text-4xl md:text-6xl font-bold tracking-tight mb-6 text-foreground">
          Tu portafolio de inversiones,{' '}
          <span className="text-primary">en un solo lugar</span>
        </h1>
        <p className="text-lg text-muted-foreground mb-10 max-w-2xl mx-auto">
          Rastrea tus inversiones de GBM+, analiza mercados en tiempo real, y toma mejores decisiones financieras.
        </p>
        <div className="flex gap-4 justify-center flex-wrap">
          <Link href="/register">
            <Button size="lg" className="text-lg px-8 py-6 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg shadow-primary/20">
              Empezar gratis
            </Button>
          </Link>
          <Link href="/market">
            <Button size="lg" variant="outline" className="text-lg px-8 py-6 rounded-xl border-border hover:bg-secondary">
              Ver mercados
            </Button>
          </Link>
        </div>
      </section>

      {/* Dashboard Mockup */}
      <section className="max-w-4xl mx-auto px-6 pb-16">
        <div className="bg-card rounded-2xl border border-border shadow-xl shadow-foreground/5 p-6 md:p-8">
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="bg-secondary rounded-xl p-4">
              <p className="text-xs text-muted-foreground mb-1">Valor Total</p>
              <p className="text-xl font-bold font-mono text-foreground">$847,231.50</p>
              <p className="text-xs text-gain">+2.4% hoy</p>
            </div>
            <div className="bg-secondary rounded-xl p-4">
              <p className="text-xs text-muted-foreground mb-1">Ganancia Total</p>
              <p className="text-xl font-bold font-mono text-gain">+$123,456.00</p>
              <p className="text-xs text-muted-foreground">+17.1%</p>
            </div>
            <div className="bg-secondary rounded-xl p-4">
              <p className="text-xs text-muted-foreground mb-1">Posiciones</p>
              <p className="text-xl font-bold font-mono text-foreground">12</p>
              <p className="text-xs text-muted-foreground">activos</p>
            </div>
          </div>
          <div className="h-32 bg-secondary rounded-xl flex items-end px-4 pb-4 gap-1">
            {[40, 45, 38, 52, 48, 55, 60, 58, 65, 70, 68, 75, 72, 80, 78, 85, 82, 88, 90, 95].map((h, i) => (
              <div key={i} className="flex-1 bg-primary/20 rounded-t" style={{ height: `${h}%` }} />
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="max-w-5xl mx-auto px-6 pb-20">
        <h2 className="text-2xl font-bold text-center mb-12 text-foreground">Todo lo que necesitas</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {features.map(feature => (
            <div key={feature.title} className="bg-card rounded-2xl border border-border p-6 shadow-sm hover:shadow-md transition-shadow">
              <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-primary/10 mb-4">
                <feature.icon className="h-5 w-5 text-primary" />
              </div>
              <h3 className="font-semibold text-lg mb-2 text-foreground">{feature.title}</h3>
              <p className="text-sm text-muted-foreground">{feature.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Integration */}
      <section className="max-w-3xl mx-auto px-6 pb-16 text-center">
        <div className="bg-card rounded-2xl border border-border p-8">
          <FileSpreadsheet className="h-10 w-10 text-primary mx-auto mb-4" />
          <h3 className="font-bold text-lg mb-2 text-foreground">Importa desde GBM+</h3>
          <p className="text-sm text-muted-foreground mb-4">Sube tu estado de cuenta CSV y tus transacciones se importan automaticamente.</p>
          <div className="flex gap-3 justify-center text-xs text-muted-foreground">
            <span className="bg-secondary px-3 py-1 rounded-full">BMV</span>
            <span className="bg-secondary px-3 py-1 rounded-full">NYSE</span>
            <span className="bg-secondary px-3 py-1 rounded-full">NASDAQ</span>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-8 text-center text-sm text-muted-foreground">
        <p>InvestTracker — Hecho en Mexico</p>
      </footer>
    </div>
  )
}
