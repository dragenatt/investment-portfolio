'use client'

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'

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

  // Global keyboard shortcut: T key opens trade modal
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Skip if user is typing in an input, textarea, select, or contenteditable element
      const target = e.target as HTMLElement
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable
      ) {
        return
      }

      if (e.key === 'T' || e.key === 't') {
        // Don't trigger if modifier keys are held (Ctrl+T, Cmd+T, etc.)
        if (e.metaKey || e.ctrlKey || e.altKey) return
        e.preventDefault()
        openTrade()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [openTrade])

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
