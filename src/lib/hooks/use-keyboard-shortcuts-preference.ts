'use client'

import { useSyncExternalStore } from 'react'
import { readShortcutsEnabled, SHORTCUTS_STORAGE_KEY } from '@/lib/utils/keyboard-shortcuts'

// The single-key shortcut preference (C5), shared by every handler and the
// switch in Ajustes. localStorage is an external store: read it with
// useSyncExternalStore, and tell same-tab subscribers when it changes (the
// storage event only reaches other tabs).

const CHANGE_EVENT = 'keyboard-shortcuts-change'

function subscribe(callback: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === SHORTCUTS_STORAGE_KEY) callback()
  }
  window.addEventListener('storage', onStorage)
  window.addEventListener(CHANGE_EVENT, callback)
  return () => {
    window.removeEventListener('storage', onStorage)
    window.removeEventListener(CHANGE_EVENT, callback)
  }
}

function getSnapshot() {
  return readShortcutsEnabled(typeof localStorage === 'undefined' ? null : localStorage)
}

export function useKeyboardShortcutsEnabled(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => true)
}

export function setKeyboardShortcutsEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(SHORTCUTS_STORAGE_KEY, enabled ? 'true' : 'false')
  } catch {
    // Storage unavailable: the preference cannot persist, nothing else to do.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT))
}
