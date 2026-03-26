'use client'

import { ThemeToggle } from './theme-toggle'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { LogOut, Search, Bell, Plus, Menu } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { useCurrency } from '@/lib/hooks/use-currency'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import Link from 'next/link'
import { useState, useEffect } from 'react'

interface TopbarProps {
  onMenuClick?: () => void
}

export function Topbar({ onMenuClick }: TopbarProps) {
  const router = useRouter()
  const supabase = createClient()
  const { currency, setCurrency } = useCurrency()
  const [initials, setInitials] = useState('U')

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user?.user_metadata?.display_name) {
        const name = user.user_metadata.display_name as string
        setInitials(name.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2))
      } else if (user?.email) {
        setInitials(user.email[0].toUpperCase())
      }
    })
  }, [supabase])

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  function openSearch() {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))
  }

  return (
    <header
      className="sticky top-0 z-20 flex items-center justify-between px-4 lg:px-6 h-14 border-b border-border bg-background/85 backdrop-blur-lg"
    >
      {/* Left: hamburger on mobile + search */}
      <div className="flex items-center gap-3 flex-1">
        <button
          onClick={onMenuClick}
          className="lg:hidden p-2 rounded-lg hover:bg-secondary text-muted-foreground"
        >
          <Menu className="h-5 w-5" />
        </button>

        <button
          onClick={openSearch}
          className="flex items-center gap-2 px-4 h-10 rounded-full border border-border bg-secondary hover:bg-secondary/80 text-muted-foreground text-sm transition-colors max-w-md w-full lg:w-96"
        >
          <Search className="h-4 w-4 shrink-0" />
          <span className="hidden sm:inline">Buscar activos, portafolios...</span>
          <span className="sm:hidden">Buscar...</span>
          <kbd className="hidden sm:inline-flex ml-auto h-5 items-center gap-1 rounded border border-border bg-background px-1.5 text-[10px] text-muted-foreground font-mono">
            ⌘K
          </kbd>
        </button>
      </div>

      {/* Right: actions */}
      <div className="flex items-center gap-2">
        <Select value={currency} onValueChange={(v) => v && setCurrency(v)}>
          <SelectTrigger className="w-20 h-8 border-border text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="MXN">MXN</SelectItem>
            <SelectItem value="USD">USD</SelectItem>
            <SelectItem value="EUR">EUR</SelectItem>
          </SelectContent>
        </Select>

        <Link href="/alerts">
          <Button
            variant="outline"
            size="sm"
            className="rounded-full gap-1.5 h-8 px-3 text-xs"
          >
            <Bell className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Alertas</span>
          </Button>
        </Link>

        <Link href="/portfolio/new">
          <Button
            size="sm"
            className="rounded-full gap-1.5 h-8 px-3 text-xs"
          >
            <Plus className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Nuevo</span>
          </Button>
        </Link>

        <ThemeToggle />

        <DropdownMenu>
          <DropdownMenuTrigger className="inline-flex items-center justify-center rounded-full text-sm font-medium transition-colors hover:bg-accent h-9 w-9">
            <Avatar className="h-8 w-8 ring-2 ring-primary/30">
              <AvatarFallback className="bg-primary/10 text-primary text-sm">{initials}</AvatarFallback>
            </Avatar>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => router.push('/settings')}>
              Configuracion
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleLogout}>
              <LogOut className="h-4 w-4 mr-2" /> Cerrar sesion
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
