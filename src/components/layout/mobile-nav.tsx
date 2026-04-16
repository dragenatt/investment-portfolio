'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { LayoutDashboard, Briefcase, TrendingUp, Eye, Lightbulb } from 'lucide-react'

const navItems = [
  { href: '/dashboard', label: 'Inicio', icon: LayoutDashboard },
  { href: '/portfolio', label: 'Portafolios', icon: Briefcase },
  { href: '/market', label: 'Mercados', icon: TrendingUp },
  { href: '/watchlist', label: 'Watchlist', icon: Eye },
  { href: '/advisor', label: 'Asesor', icon: Lightbulb },
]

export function MobileNav() {
  const pathname = usePathname()

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 border-t border-border bg-card z-50">
      <div className="flex justify-around py-2">
        {navItems.map(item => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'flex flex-col items-center gap-0.5 px-2 py-1 text-xs transition-colors',
              pathname.startsWith(item.href)
                ? 'text-primary font-medium'
                : 'text-muted-foreground'
            )}
          >
            <item.icon className="h-5 w-5" />
            <span>{item.label}</span>
          </Link>
        ))}
      </div>
    </nav>
  )
}
