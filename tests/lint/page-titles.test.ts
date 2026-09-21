import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'

// Every page inside the app shared one browser-tab title, "InvestTracker":
// twelve open tabs, twelve identical labels, and a screen reader announcing the
// same name for every page it landed on. The pages are client components and
// cannot export metadata, so each one's title lives in a layout.tsx beside it.
//
// This keeps a new page from arriving without one.

const APP = join(process.cwd(), 'src', 'app', '(app)')

// Answers 404 to anyone who is not an admin. A title would name the page on
// that 404 and tell a visitor it exists.
const UNTITLED = new Set(['admin/metrics'])

function pages(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) pages(path, out)
    else if (entry === 'page.tsx') out.push(path)
  }
  return out
}

function declaresTitle(file: string): boolean {
  if (!existsSync(file)) return false
  const source = readFileSync(file, 'utf8')
  return /export\s+(const\s+metadata\b|async\s+function\s+generateMetadata\b|function\s+generateMetadata\b)/.test(source)
}

const found = pages(APP)

describe('every page in the app says what it is in the tab', () => {
  it('finds the pages at all, so an empty pass is not a pass', () => {
    expect(found.length).toBeGreaterThan(20)
  })

  it('gives each page a title of its own', () => {
    const untitled = found
      .map((page) => ({
        page,
        route: dirname(page).replace(APP, '').split(String.fromCharCode(92)).join('/').replace(/^\//, ''),
      }))
      .filter(({ route }) => !UNTITLED.has(route))
      .filter(({ page }) => !declaresTitle(page) && !declaresTitle(join(dirname(page), 'layout.tsx')))
      .map(({ route }) => route)

    expect(untitled, 'add a layout.tsx beside the page that exports metadata with a title').toEqual([])
  })
})
