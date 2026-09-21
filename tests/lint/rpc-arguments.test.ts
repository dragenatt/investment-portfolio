import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

// Three times now a route has called a Postgres function with argument names
// the function does not declare. PostgREST resolves a function by the NAMES of
// the arguments it is given, so a mismatch is not a type error or a wrong
// value — it is "Could not find the function", a 500, and a feature that has
// never worked:
//
//   get_public_portfolios(sort, page, limit)        47 errors
//   search_users(query)                             every search
//   toggle_portfolio_like(portfolio_id)             every like, 2026-09-20
//
// Nothing connects the TypeScript to the SQL, so nothing caught any of them.
// This does: every rpc() call in src/ has to name arguments the migrations
// actually declare.

const SRC = join(process.cwd(), 'src')
const MIGRATIONS = join(process.cwd(), 'supabase', 'migrations')

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) walk(path, out)
    else if (/\.(ts|tsx)$/.test(entry)) out.push(path)
  }
  return out
}

/**
 * The parameters each function declares, by name. Later migrations replace
 * earlier ones, so the files are read in order and the last definition wins —
 * the same thing Postgres ends up with.
 */
function declaredParameters(): Map<string, Set<string>> {
  const byName = new Map<string, Set<string>>()
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()

  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS, file), 'utf8')
    const pattern = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?(\w+)\s*\(([^)]*)\)/gi
    for (const match of sql.matchAll(pattern)) {
      const [, name, rawParams] = match
      const params = new Set<string>()
      for (const param of rawParams.split(',')) {
        // "target_portfolio_id UUID", "p_limit int DEFAULT 20", "OUT x text"
        const cleaned = param.trim().replace(/^(IN|OUT|INOUT|VARIADIC)\s+/i, '')
        const paramName = cleaned.split(/\s+/)[0]
        if (paramName) params.add(paramName.toLowerCase())
      }
      byName.set(name.toLowerCase(), params)
    }
  }
  return byName
}

/** The top-level keys of an object literal that starts at `text[from]`. */
function objectKeys(text: string, from: number): string[] {
  let depth = 0
  let end = from
  for (let i = from; i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}') {
      depth--
      if (depth === 0) {
        end = i
        break
      }
    }
  }
  const body = text.slice(from + 1, end)
  const keys: string[] = []
  let nesting = 0
  let current = ''
  for (const char of body) {
    if ('{[('.includes(char)) nesting++
    else if ('}])'.includes(char)) nesting--
    if (char === ',' && nesting === 0) {
      keys.push(current)
      current = ''
    } else current += char
  }
  keys.push(current)

  return keys
    .map((entry) => entry.split(':')[0].trim())
    .map((key) => key.replace(/^['"`]|['"`]$/g, ''))
    .filter((key) => key.length > 0 && /^\w+$/.test(key))
}

type Call = { file: string; fn: string; args: string[] | null; raw: string }

function rpcCalls(): Call[] {
  const calls: Call[] = []
  for (const file of walk(SRC)) {
    const text = readFileSync(file, 'utf8')
    const pattern = /\.rpc\(\s*'(\w+)'\s*,\s*/g
    for (const match of text.matchAll(pattern)) {
      const after = match.index + match[0].length
      const rest = text.slice(after)
      if (rest.startsWith('{')) {
        calls.push({ file, fn: match[1], args: objectKeys(text, after), raw: rest.slice(0, 40) })
      } else {
        // An identifier: the object is built elsewhere. Resolve it below.
        const identifier = /^(\w+)/.exec(rest)?.[1] ?? null
        calls.push({ file, fn: match[1], args: null, raw: identifier ?? rest.slice(0, 20) })
      }
    }
  }
  return calls
}

/**
 * The keys of the object an identifier holds.
 *
 * One call site builds its arguments elsewhere: `const args =
 * publicPortfolioArgs(...)`. Follow the assignment to the builder, then read
 * the object literal that builder returns.
 */
function keysBehind(identifier: string, file: string): string[] | null {
  const text = readFileSync(file, 'utf8')
  const assignment = text.indexOf('const ' + identifier + ' = ')
  if (assignment === -1) return keysReturnedBy(identifier)

  const rest = text.slice(assignment + ('const ' + identifier + ' = ').length)
  if (rest.startsWith('{')) return objectKeys(rest, 0)

  const builder = /^(?:await\s+)?(\w+)\s*\(/.exec(rest)?.[1]
  return builder ? keysReturnedBy(builder) : null
}

/** The keys of an object literal returned by a named function in src/. */
function keysReturnedBy(builder: string): string[] | null {
  for (const file of walk(SRC)) {
    const text = readFileSync(file, 'utf8')
    // Plain string search rather than a pattern: a declaration in this
    // codebase always reads `function name(`.
    const at = text.indexOf('function ' + builder + '(')
    if (at === -1) continue
    const returnAt = text.indexOf('return {', at)
    if (returnAt === -1) continue
    return objectKeys(text, text.indexOf('{', returnAt))
  }
  return null
}

/**
 * Functions the app calls that no migration in this repository creates.
 *
 * A function made by hand in production can have its arguments checked against
 * nothing, which is why a gap goes here in writing instead of being skipped
 * quietly. soft_delete_portfolio was the one entry until 014b wrote it down.
 * Keep this empty: add the missing definition rather than an entry.
 */
const UNDECLARED_IN_REPO = new Set<string>()

const declared = declaredParameters()
const calls = rpcCalls()

describe('every rpc() names arguments the function declares', () => {
  it('finds the call sites at all, so an empty pass is not a pass', () => {
    expect(calls.length).toBeGreaterThanOrEqual(5)
  })

  it('knows which functions no migration here creates', () => {
    const missing = calls.map((call) => call.fn).filter((fn) => !declared.has(fn.toLowerCase()))

    expect(new Set(missing)).toEqual(UNDECLARED_IN_REPO)
  })

  for (const call of calls.filter((c) => !UNDECLARED_IN_REPO.has(c.fn))) {
    const where = call.file.replace(process.cwd(), '').split(String.fromCharCode(92)).join('/')

    it(`${call.fn} in ${where}`, () => {
      const params = declared.get(call.fn.toLowerCase())
      expect(params, `${call.fn} is not defined in any migration`).toBeDefined()

      const args = call.args ?? keysBehind(call.raw, call.file)
      expect(args, `could not read the arguments passed to ${call.fn} (${call.raw})`).not.toBeNull()

      for (const arg of args!) {
        expect(
          params!.has(arg.toLowerCase()),
          `${call.fn}(${arg}) — the function declares ${[...params!].join(', ') || 'no arguments'}`,
        ).toBe(true)
      }
    })
  }
})
