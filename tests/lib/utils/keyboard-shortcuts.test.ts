import { describe, it, expect } from 'vitest'
import { readShortcutsEnabled, shouldHandleCharacterShortcut, SHORTCUTS_STORAGE_KEY } from '@/lib/utils/keyboard-shortcuts'

function keydown(key: string, target: EventTarget | null = document.body, mods: Partial<Record<'metaKey' | 'ctrlKey' | 'altKey', boolean>> = {}) {
  return { key, target, metaKey: false, ctrlKey: false, altKey: false, ...mods }
}

describe('shouldHandleCharacterShortcut', () => {
  it('handles a plain letter on the page', () => {
    expect(shouldHandleCharacterShortcut(keydown('d'), true)).toBe(true)
  })

  it('does nothing when the user turned shortcuts off (WCAG 2.1.4)', () => {
    expect(shouldHandleCharacterShortcut(keydown('d'), false)).toBe(false)
  })

  it('ignores the key when a modifier is held — Ctrl+C used to open /compare', () => {
    expect(shouldHandleCharacterShortcut(keydown('c', document.body, { ctrlKey: true }), true)).toBe(false)
    expect(shouldHandleCharacterShortcut(keydown('p', document.body, { metaKey: true }), true)).toBe(false)
    expect(shouldHandleCharacterShortcut(keydown('d', document.body, { altKey: true }), true)).toBe(false)
  })

  it('ignores keys that are not a single character', () => {
    expect(shouldHandleCharacterShortcut(keydown('Enter'), true)).toBe(false)
    expect(shouldHandleCharacterShortcut(keydown('ArrowDown'), true)).toBe(false)
  })

  it('leaves letters to text fields and editable content', () => {
    const input = document.createElement('input')
    const textarea = document.createElement('textarea')
    const editable = document.createElement('div')
    editable.contentEditable = 'true'
    // jsdom does not implement isContentEditable
    Object.defineProperty(editable, 'isContentEditable', { value: true })
    for (const target of [input, textarea, editable]) {
      expect(shouldHandleCharacterShortcut(keydown('d', target), true)).toBe(false)
    }
  })

  it('leaves letters to widgets with typeahead, and to open dialogs and menus', () => {
    const combobox = document.createElement('button')
    combobox.setAttribute('role', 'combobox')
    expect(shouldHandleCharacterShortcut(keydown('m', combobox), true)).toBe(false)

    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    const button = document.createElement('button')
    dialog.appendChild(button)
    document.body.appendChild(dialog)
    expect(shouldHandleCharacterShortcut(keydown('t', button), true)).toBe(false)
    dialog.remove()
  })

  it('still works from a focused ordinary button or link', () => {
    const link = document.createElement('a')
    document.body.appendChild(link)
    expect(shouldHandleCharacterShortcut(keydown('w', link), true)).toBe(true)
    link.remove()
  })
})

describe('readShortcutsEnabled', () => {
  it('is on by default and off only when explicitly stored as false', () => {
    expect(readShortcutsEnabled(null)).toBe(true)
    expect(readShortcutsEnabled({ getItem: () => null })).toBe(true)
    expect(readShortcutsEnabled({ getItem: (k) => (k === SHORTCUTS_STORAGE_KEY ? 'false' : null) })).toBe(false)
    expect(readShortcutsEnabled({ getItem: () => 'true' })).toBe(true)
  })

  it('treats unreadable storage as on', () => {
    expect(readShortcutsEnabled({ getItem: () => { throw new Error('denied') } })).toBe(true)
  })
})
