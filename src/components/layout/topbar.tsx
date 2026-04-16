'use client'

import { ThemeToggle } from './theme-toggle'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { LogOut, Search, Menu } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { useState, useEffect } from 'react'

interface TopbarProps {
  onMenuClick?: () => void
}

export function Topbar({ onMenuClick }: TopbarProps) {
  const router = useRouter()
  const supabase = createClient()
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
          className="flex items-center gap-2 px-4 h-9 rounded-full border border-border bg-secondary/50 hover:bg-secondary text-muted-foreground text-sm transition-colors max-w-sm w-full lg:w-72"
        >
          <Search className="h-4 w-4 shrink-0" />
          <span className="hidden sm:inline">Buscar...</span>
          <span className="sm:hidden">Buscar</span>
        </button>
      </div>

      {/* Right: actions */}
      <div className="flex items-center gap-1.5">
        <ThemeToggle />

        <DropdownMenu>
          <DropdownMenuTrigger className="inline-flex items-center justify-center rounded-full text-sm font-medium transition-colors hover:bg-accent h-9 w-9">
            <Avatar className="h-8 w-8">
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
