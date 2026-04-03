'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { LayoutDashboard, Briefcase, TrendingUp, Eye, Bell, GraduationCap, Settings, X, Compass, GitCompareArrows } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useEffect, useCallback } from 'react'
import { useTranslation } from '@/lib/i18n'
import type { Dictionary } from '@/lib/i18n'

function getNavItems(t: Dictionary) {
  return [
    { href: '/dashboard', icon: LayoutDashboard, label: t.nav.dashboard, desc: t.nav.dashboard_desc, shortcut: 'D' },
    { href: '/portfolio', icon: Briefcase, label: t.nav.portfolios, desc: t.nav.portfolios_desc, shortcut: 'P' },
    { href: '/market', icon: TrendingUp, label: t.nav.markets, desc: t.nav.markets_desc, shortcut: 'M' },
    { href: '/watchlist', icon: Eye, label: t.nav.watchlist, desc: t.nav.watchlist_desc, shortcut: 'W' },
    { href: '/alerts', icon: Bell, label: t.nav.alerts, desc: t.nav.alerts_desc, shortcut: 'L' },
    { href: '/discover', icon: Compass, label: 'Descubrir', desc: 'Explora portafolios', shortcut: 'X' },
    { href: '/compare', icon: GitCompareArrows, label: 'Comparar', desc: 'Compara rendimientos', shortcut: 'C' },
    { href: '/advisor', icon: GraduationCap, label: t.nav.advisor, desc: t.nav.advisor_desc, shortcut: 'R' },
    { href: '/settings', icon: Settings, label: t.nav.settings, desc: t.nav.settings_desc, shortcut: 'S' },
  ]
}

interface SidebarProps {
  mobileOpen?: boolean
  onMobileClose?: () => void
}

export function Sidebar({ mobileOpen, onMobileClose }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const { t } = useTranslation()
  const navItems = getNavItems(t)

  const handleKeyboardNav = useCallback((e: KeyboardEvent) => {
    // Don't trigger if user is typing in an input/textarea/contenteditable
    const target = e.target as HTMLElement
    if (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT' ||
      target.isContentEditable
    ) {
      return
    }

    const key = e.key.toUpperCase()
    const item = navItems.find((n) => n.shortcut === key)
    if (item) {
      e.preventDefault()
      router.push(item.href)
    }
  }, [router])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyboardNav)
    return () => window.removeEventListener('keydown', handleKeyboardNav)
  }, [handleKeyboardNav])

  // Close mobile sidebar on route change
  useEffect(() => {
    if (mobileOpen && onMobileClose) {
      onMobileClose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])

  return (
    <>
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-40 lg:hidden"
          onClick={onMobileClose}
        />
      )}

      <aside
        className={cn(
          'fixed top-0 left-0 z-50 h-screen flex flex-col border-r border-border bg-card',
          'transition-transform duration-300 ease-in-out',
          'lg:sticky lg:translate-x-0 lg:z-auto',
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        )}
        style={{ width: 280, minWidth: 280 }}
      >
        {/* Brand */}
        <div className="p-4 border-b border-border">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary to-primary/70 shadow-lg flex items-center justify-center">
                <TrendingUp className="h-5 w-5 text-primary-foreground" />
              </div>
              <div>
                <h1 className="text-base font-bold tracking-tight">InvestTracker</h1>
                <p className="text-xs text-muted-foreground">Portfolio Intelligence</p>
              </div>
            </div>
            {/* Close button on mobile */}
            <button
              onClick={onMobileClose}
              className="lg:hidden p-1.5 rounded-lg hover:bg-secondary text-muted-foreground"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-2.5 flex flex-col gap-1.5 overflow-y-auto">
          {navItems.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
            const Icon = item.icon
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'relative flex items-center justify-between gap-3 px-3 py-3 rounded-xl transition-all duration-200',
                  isActive
                    ? 'bg-primary/8 text-foreground'
                    : 'hover:bg-secondary text-foreground/80'
                )}
              >
                {/* Active indicator bar */}
                {isActive && (
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-primary" />
                )}
                <div className="flex items-center gap-3 min-w-0">
                  <Icon className={cn(
                    'h-5 w-5 shrink-0',
                    isActive ? 'text-primary' : 'text-muted-foreground'
                  )} />
                  <div className="min-w-0">
                    <div className="font-semibold text-sm tracking-wide">{item.label}</div>
                    <span className="text-xs text-muted-foreground">{item.desc}</span>
                  </div>
                </div>
                <span className="hidden lg:inline font-mono text-xs text-muted-foreground border border-border rounded-full px-2.5 py-1 bg-secondary">
                  {item.shortcut}
                </span>
              </Link>
            )
          })}
        </nav>

        {/* Footer CTA */}
        <div className="p-3 border-t border-border mt-auto">
          <div className="rounded-2xl border border-border p-4 bg-gradient-to-br from-primary/5 to-transparent">
            <h3 className="text-sm font-bold tracking-tight mb-1">{t.nav.portfolio_center}</h3>
            <p className="text-xs text-muted-foreground mb-3">
              {t.nav.portfolio_summary}
            </p>
            <div className="flex gap-2 flex-wrap">
              <Link
                href="/portfolio/new"
                className="inline-flex items-center justify-center rounded-lg bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium hover:bg-primary/90 transition-colors"
              >
                {t.nav.new_portfolio}
              </Link>
            </div>
          </div>
        </div>
      </aside>
    </>
  )
}
