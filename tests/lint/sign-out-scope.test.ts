import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

// supabase.auth.signOut() with no argument revokes EVERY session the account
// has — its default scope is 'global'. The menu's sign-out button called it
// that way, so leaving on a phone also signed out the laptop. Each call now
// says which it means: 'local' for this device, 'global' only where the
// interface asks for every device by name.

const SRC = join(process.cwd(), 'src')

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) walk(path, out)
    else if (/\.(ts|tsx)$/.test(entry)) out.push(path)
  }
  return out
}

describe('every sign-out says which sessions it ends', () => {
  const calls = walk(SRC).flatMap((file) =>
    [...readFileSync(file, 'utf8').matchAll(/auth\.signOut\(([^)]*)\)/g)].map((match) => ({
      file: file.replace(process.cwd(), '').split(String.fromCharCode(92)).join('/'),
      args: match[1].trim(),
    })),
  )

  it('finds the sign-out calls at all, so an empty pass is not a pass', () => {
    expect(calls.length).toBeGreaterThanOrEqual(2)
  })

  it('passes an explicit scope to each one', () => {
    expect(calls.filter((call) => !/scope:\s*'(local|global|others)'/.test(call.args))).toEqual([])
  })
})
