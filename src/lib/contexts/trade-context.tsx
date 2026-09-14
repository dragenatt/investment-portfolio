'use client'

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import { shouldHandleCharacterShortcut } from '@/lib/utils/keyboard-shortcuts'
import { useKeyboardShortcutsEnabled } from '@/lib/hooks/use-keyboard-shortcuts-preference'

export interface TradeOptions {
  symbol?: string
  portfolioId?: string
  type?: 'buy' | 'sell' | 'dividend'
}

export interface TradeContextValue {
  openTrade: (opts?: TradeOptions) => void
  closeTrade: () => void
  isOpen: boolean
  initialOptions: TradeOptions | null
}

const TradeContext = createContext<TradeContextValue | null>(null)

export function TradeProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)
  const [initialOptions, setInitialOptions] = useState<TradeOptions | null>(null)

  const openTrade = useCallback((opts?: TradeOptions) => {
    setInitialOptions(opts ?? null)
    setIsOpen(true)
  }, [])

  const closeTrade = useCallback(() => {
    setIsOpen(false)
    setInitialOptions(null)
  }, [])

  const shortcutsEnabled = useKeyboardShortcutsEnabled()

  // Global keyboard shortcut: T opens the trade modal. The shared check skips
  // text fields, typeahead widgets, open dialogs, modifier combinations, and
  // applies the user's choice to turn single-key shortcuts off (C5).
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== 'T' && e.key !== 't') return
      if (!shouldHandleCharacterShortcut(e, shortcutsEnabled)) return
      e.preventDefault()
      openTrade()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [openTrade, shortcutsEnabled])

  return (
    <TradeContext.Provider value={{ openTrade, closeTrade, isOpen, initialOptions }}>
      {children}
    </TradeContext.Provider>
  )
}

export function useTrade(): TradeContextValue {
  const ctx = useContext(TradeContext)
  if (!ctx) {
    throw new Error('useTrade must be used within a TradeProvider')
  }
  return ctx
}
