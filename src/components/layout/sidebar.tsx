'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { LayoutDashboard, Briefcase, TrendingUp, Eye, Lightbulb, Target, Bell, Compass, GitCompareArrows, FlaskConical, Settings, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useEffect, useCallback, useSyncExternalStore } from 'react'
import { useTranslation } from '@/lib/i18n'
import type { Dictionary } from '@/lib/i18n'
import { shouldHandleCharacterShortcut } from '@/lib/utils/keyboard-shortcuts'
import { useKeyboardShortcutsEnabled } from '@/lib/hooks/use-keyboard-shortcuts-preference'

type NavItem = { href: string; icon: typeof LayoutDashboard; label: string; shortcut: string }

function getPrimaryItems(t: Dictionary): NavItem[] {
  return [
    { href: '/dashboard', icon: LayoutDashboard, label: t.nav.dashboard, shortcut: 'D' },
    { href: '/portfolio', icon: Briefcase, label: t.nav.portfolios, shortcut: 'P' },
    { href: '/market', icon: TrendingUp, label: t.nav.markets, shortcut: 'M' },
    { href: '/watchlist', icon: Eye, label: t.nav.watchlist, shortcut: 'W' },
    { href: '/advisor', icon: Lightbulb, label: t.nav.advisor, shortcut: 'A' },
    // P1-8/P1-9: saved plans and their progress. Next to the advisor, which is where they come from.
    { href: '/goals', icon: Target, label: 'Metas', shortcut: 'G' },
  ]
}

function getToolItems(t: Dictionary): NavItem[] {
  return [
    { href: '/alerts', icon: Bell, label: t.nav.alerts, shortcut: 'L' },
    { href: '/discover', icon: Compass, label: 'Descubrir', shortcut: 'X' },
    { href: '/compare', icon: GitCompareArrows, label: 'Comparar', shortcut: 'C' },
    { href: '/lab', icon: FlaskConical, label: 'Laboratorio', shortcut: 'B' },
  ]
}

interface SidebarProps {
  mobileOpen?: boolean
  onMobileClose?: () => void
}

function NavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
  const Icon = item.icon
  return (
    <Link
      href={item.href}
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        'relative flex items-center gap-2.5 px-3 py-2 rounded-lg transition-all duration-200',
        isActive
          ? 'bg-primary/8 text-foreground'
          : 'hover:bg-secondary text-foreground/70'
      )}
    >
      {isActive && (
        <div aria-hidden="true" className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 rounded-r-full bg-primary" />
      )}
      <Icon aria-hidden="true" className={cn(
        'h-[18px] w-[18px] shrink-0',
        isActive ? 'text-primary' : 'text-muted-foreground'
      )} />
      <span className="font-medium text-sm">{item.label}</span>
    </Link>
  )
}

const DESKTOP_QUERY = '(min-width: 1024px)'

function subscribeDesktop(callback: () => void) {
  const query = window.matchMedia(DESKTOP_QUERY)
  query.addEventListener('change', callback)
  return () => query.removeEventListener('change', callback)
}

export function Sidebar({ mobileOpen, onMobileClose }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const { t } = useTranslation()
  const primaryItems = getPrimaryItems(t)
  const toolItems = getToolItems(t)
  const allItems = [...primaryItems, ...toolItems, { href: '/settings', icon: Settings, label: t.nav.settings, shortcut: 'S' }]

  const shortcutsEnabled = useKeyboardShortcutsEnabled()
  // Below lg the sidebar is a drawer. Closed, it sits off-screen, and without
  // inert its links stayed in the tab order: focus disappeared into it (C5).
  const isDesktop = useSyncExternalStore(
    subscribeDesktop,
    () => window.matchMedia(DESKTOP_QUERY).matches,
    () => true,
  )

  const handleKeyboardNav = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape' && mobileOpen) {
      onMobileClose?.()
      return
    }
    if (!shouldHandleCharacterShortcut(e, shortcutsEnabled)) return

    const key = e.key.toUpperCase()
    const item = allItems.find((n) => n.shortcut === key)
    if (item) {
      e.preventDefault()
      router.push(item.href)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, shortcutsEnabled, mobileOpen, onMobileClose])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyboardNav)
    return () => window.removeEventListener('keydown', handleKeyboardNav)
  }, [handleKeyboardNav])

  useEffect(() => {
    if (mobileOpen && onMobileClose) {
      onMobileClose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])

  return (
    <>
      {mobileOpen && (
        <div
          aria-hidden="true"
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
        style={{ width: 200, minWidth: 200 }}
        aria-label="Navegación principal"
        inert={!isDesktop && !mobileOpen}
      >
        {/* Brand */}
        <div className="px-4 py-3.5 border-b border-border">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center">
                <TrendingUp aria-hidden="true" className="h-3.5 w-3.5 text-primary-foreground" />
              </div>
              {/* Not a heading: every page has its own h1, and this one repeated on all of them. */}
              <span className="text-sm font-bold tracking-tight">InvestTracker</span>
            </div>
            <button
              type="button"
              aria-label="Cerrar menú"
              onClick={onMobileClose}
              className="lg:hidden p-1.5 rounded-lg hover:bg-secondary text-muted-foreground"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-2 flex flex-col overflow-y-auto">
          {/* Primary items */}
          <div className="flex flex-col gap-0.5">
            {primaryItems.map((item) => (
              <NavLink key={item.href} item={item} pathname={pathname} />
            ))}
          </div>

          {/* Tools section */}
          <div className="mt-4 pt-3 border-t border-border">
            <p className="px-3 mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Herramientas
            </p>
            <div className="flex flex-col gap-0.5">
              {toolItems.map((item) => (
                <NavLink key={item.href} item={item} pathname={pathname} />
              ))}
            </div>
          </div>

          {/* Settings at bottom */}
          <div className="mt-auto pt-3 border-t border-border">
            <NavLink
              item={{ href: '/settings', icon: Settings, label: t.nav.settings, shortcut: 'S' }}
              pathname={pathname}
            />
          </div>
        </nav>
      </aside>
    </>
  )
}
