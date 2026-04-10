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
    { href: '/dashboard', icon: LayoutDashboard, label: t.nav.dashboard, shortcut: 'D' },
    { href: '/portfolio', icon: Briefcase, label: t.nav.portfolios, shortcut: 'P' },
    { href: '/market', icon: TrendingUp, label: t.nav.markets, shortcut: 'M' },
    { href: '/watchlist', icon: Eye, label: t.nav.watchlist, shortcut: 'W' },
    { href: '/alerts', icon: Bell, label: t.nav.alerts, shortcut: 'L' },
    { href: '/discover', icon: Compass, label: 'Descubrir', shortcut: 'X' },
    { href: '/compare', icon: GitCompareArrows, label: 'Comparar', shortcut: 'C' },
    { href: '/advisor', icon: GraduationCap, label: t.nav.advisor, shortcut: 'R' },
    { href: '/settings', icon: Settings, label: t.nav.settings, shortcut: 'S' },
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
        style={{ width: 240, minWidth: 240 }}
      >
        {/* Brand */}
        <div className="px-4 py-3.5 border-b border-border">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-primary/70 shadow-md flex items-center justify-center">
                <TrendingUp className="h-4 w-4 text-primary-foreground" />
              </div>
              <h1 className="text-sm font-bold tracking-tight">InvestTracker</h1>
            </div>
            <button
              onClick={onMobileClose}
              className="lg:hidden p-1.5 rounded-lg hover:bg-secondary text-muted-foreground"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-2 flex flex-col gap-0.5 overflow-y-auto">
          {navItems.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
            const Icon = item.icon
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'relative flex items-center justify-between gap-2.5 px-3 py-2.5 rounded-lg transition-all duration-200',
                  isActive
                    ? 'bg-primary/8 text-foreground'
                    : 'hover:bg-secondary text-foreground/80'
                )}
              >
                {isActive && (
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 rounded-r-full bg-primary" />
                )}
                <div className="flex items-center gap-2.5 min-w-0">
                  <Icon className={cn(
                    'h-[18px] w-[18px] shrink-0',
                    isActive ? 'text-primary' : 'text-muted-foreground'
                  )} />
                  <span className="font-medium text-sm">{item.label}</span>
                </div>
                <kbd className="hidden lg:inline font-mono text-[10px] text-muted-foreground/60">
                  {item.shortcut}
                </kbd>
              </Link>
            )
          })}
        </nav>

      </aside>
    </>
  )
}
