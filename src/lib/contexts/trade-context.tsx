'use client'

import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode, type RefObject } from 'react'
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
  /**
   * Where focus was when the modal opened. The modal is opened by buttons all
   * over the app and by the T shortcut, so there is no single trigger for the
   * dialog to return focus to; without this, closing it dropped keyboard users
   * at the top of the page (C5).
   */
  returnFocusRef: RefObject<HTMLElement | null>
}

const TradeContext = createContext<TradeContextValue | null>(null)

export function TradeProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)
  const [initialOptions, setInitialOptions] = useState<TradeOptions | null>(null)

  const returnFocusRef = useRef<HTMLElement | null>(null)

  const openTrade = useCallback((opts?: TradeOptions) => {
    const active = typeof document !== 'undefined' ? document.activeElement : null
    returnFocusRef.current = active instanceof HTMLElement && active !== document.body ? active : null
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
    <TradeContext.Provider value={{ openTrade, closeTrade, isOpen, initialOptions, returnFocusRef }}>
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
