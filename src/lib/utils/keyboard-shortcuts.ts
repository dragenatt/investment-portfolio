// Single-key shortcuts (C5): D for the dashboard, T for a new trade, and so on.
//
// WCAG 2.1.4 (Character Key Shortcuts, level A): a shortcut made of one
// character must be possible to turn off. Speech-input users dictate words that
// contain those letters, and screen-reader users press them to move around the
// page; either way a stray letter would navigate away. The preference lives in
// localStorage and is switched in Ajustes.
//
// The sidebar handler also used to fire with modifiers held: Ctrl+C to copy
// opened /compare and Ctrl+P opened /portfolio. Any modifier now means the key
// belongs to the browser or the OS.

export const SHORTCUTS_STORAGE_KEY = 'keyboard_shortcuts_enabled'

type KeyEventLike = Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey'> & {
  target: EventTarget | null
}

/** Roles whose widgets use letters themselves (typeahead, text entry). */
const LETTER_CONSUMING_ROLES = new Set([
  'textbox',
  'searchbox',
  'combobox',
  'listbox',
  'option',
  'menu',
  'menuitem',
  'menuitemradio',
  'menuitemcheckbox',
  'slider',
  'spinbutton',
  'grid',
  'tree',
])

function isElementLike(target: EventTarget | null): target is HTMLElement {
  return !!target && typeof (target as HTMLElement).closest === 'function'
}

/** Whether a keydown may trigger a single-character app shortcut. */
export function shouldHandleCharacterShortcut(event: KeyEventLike, enabled: boolean): boolean {
  if (!enabled) return false
  if (event.metaKey || event.ctrlKey || event.altKey) return false
  if (typeof event.key !== 'string' || event.key.length !== 1) return false

  const target = event.target
  if (isElementLike(target)) {
    const tag = target.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) return false
    const role = target.getAttribute('role')
    if (role && LETTER_CONSUMING_ROLES.has(role)) return false
    // Inside a dialog or an open menu the letters belong to what is open.
    if (target.closest('[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"]')) return false
  }
  return true
}

/** Stored preference; shortcuts are on unless someone turned them off. */
export function readShortcutsEnabled(storage: Pick<Storage, 'getItem'> | null | undefined): boolean {
  try {
    return storage?.getItem(SHORTCUTS_STORAGE_KEY) !== 'false'
  } catch {
    return true
  }
}
