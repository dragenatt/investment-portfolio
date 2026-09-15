// @vitest-environment node
//
// portfolios has no `currency` column; it is `base_currency`. A select that
// names `currency` fails, supabase-js returns { data: null, error } without
// throwing, and every caller had a fallback: the risk, scenario, backtest,
// factor and optimisation calculations quietly used the US Treasury rate for
// peso portfolios, the nightly snapshots wrote nothing for months, and
// /api/compare answered 500. This fails on any select from portfolios that
// names the column that does not exist.
//
// Parsed with the TypeScript compiler, so comments and prose never trip it.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

const SRC = path.resolve(__dirname, '../../src')

/** Columns portfolios does not have, and the one to use instead. */
const MISSING_COLUMNS: Record<string, string> = { currency: 'base_currency' }

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return files(full)
    return /\.tsx?$/.test(entry.name) ? [full] : []
  })
}

const rel = (file: string) => path.relative(SRC, file).replace(/\\/g, '/')

function walk(node: ts.Node, visit: (n: ts.Node) => void) {
  visit(node)
  node.forEachChild((child) => walk(child, visit))
}

function methodCall(node: ts.Node, name: string): ts.CallExpression | null {
  return ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === name
    ? node
    : null
}

function stringArg(call: ts.CallExpression): string | null {
  const [arg] = call.arguments
  if (!arg) return null
  if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) return arg.text
  return null
}

/** Top-level column names in a PostgREST select, ignoring aliases and embeds. */
export function selectedColumns(select: string): string[] {
  let depth = 0
  let current = ''
  const parts: string[] = []
  for (const ch of select) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) {
      parts.push(current)
      current = ''
    } else if (depth === 0 && ch !== ')') {
      current += ch
    }
  }
  parts.push(current)
  return parts
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && !p.includes(':') && !p.includes('!'))
    .map((p) => p.split('(')[0].trim())
}

function offenders(): string[] {
  const found: string[] = []
  for (const file of files(SRC)) {
    const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
    walk(source, (node) => {
      const from = methodCall(node, 'from')
      if (!from || stringArg(from) !== 'portfolios') return
      // Climb the chain: .from('portfolios').select(...) wraps the from call.
      let current: ts.Node = from
      while (ts.isPropertyAccessExpression(current.parent) || ts.isCallExpression(current.parent)) {
        current = current.parent
        const select = methodCall(current, 'select')
        const columns = select ? stringArg(select) : null
        if (!columns) continue
        for (const column of selectedColumns(columns)) {
          if (MISSING_COLUMNS[column]) {
            const { line } = source.getLineAndCharacterOfPosition(select!.getStart())
            found.push(`${rel(file)}:${line + 1} selects "${column}" — use "${column}:${MISSING_COLUMNS[column]}"`)
          }
        }
      }
    })
  }
  return found
}

describe('portfolios columns', () => {
  it('reads the column names in a select, skipping aliases and embeds', () => {
    expect(selectedColumns('id, name, currency, visibility')).toEqual(['id', 'name', 'currency', 'visibility'])
    expect(selectedColumns('currency:base_currency, user_id')).toEqual(['user_id'])
    expect(selectedColumns('id, positions(symbol, currency), portfolios!inner(currency)')).toEqual(['id', 'positions'])
  })

  it('no select from portfolios names a column the table does not have', () => {
    expect(offenders()).toEqual([])
  })
})
