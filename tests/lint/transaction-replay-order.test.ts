// @vitest-environment node
//
// Transactions replayed oldest first must break ties on executed_at by entry
// order. The transaction modal records a date, not a time, so a buy and the sell
// that closes it share executed_at; in whatever order the database returns them,
// the sell can replay first, be clamped at zero, and leave the shares in the book.
// That put 39 sold RBLX shares back on the dashboard chart.
//
// Parsed with the TypeScript compiler, so comments and prose never trip it.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

const SRC = path.resolve(__dirname, '../../src')

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

/** `.order('<column>', { ascending: <ascending> })`, or null. */
function orderCall(node: ts.Node): { column: string; ascending: boolean | null } | null {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return null
  if (node.expression.name.text !== 'order') return null
  const [column, options] = node.arguments
  if (!column || !ts.isStringLiteral(column)) return null
  let ascending: boolean | null = null
  if (options && ts.isObjectLiteralExpression(options)) {
    for (const prop of options.properties) {
      if (ts.isPropertyAssignment(prop) && prop.name.getText() === 'ascending') {
        ascending = prop.initializer.kind === ts.SyntaxKind.TrueKeyword
      }
    }
  }
  return { column: column.text, ascending }
}

/** The whole method chain a call belongs to. */
function chainRoot(node: ts.Node): ts.Node {
  let current = node
  while (ts.isPropertyAccessExpression(current.parent) || ts.isCallExpression(current.parent)) {
    current = current.parent
  }
  return current
}

function replaysWithoutEntryOrder(): string[] {
  const offenders: string[] = []
  for (const file of files(SRC)) {
    const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
    walk(source, (node) => {
      const order = orderCall(node)
      if (!order || order.column !== 'executed_at' || order.ascending !== true) return
      let tieBroken = false
      walk(chainRoot(node), (n) => {
        if (orderCall(n)?.column === 'created_at') tieBroken = true
      })
      if (!tieBroken) {
        const { line } = source.getLineAndCharacterOfPosition(node.getStart())
        offenders.push(`${rel(file)}:${line + 1}`)
      }
    })
  }
  return offenders
}

describe('transaction replay order', () => {
  it('every oldest-first transaction query breaks executed_at ties by created_at', () => {
    expect(replaysWithoutEntryOrder()).toEqual([])
  })
})
