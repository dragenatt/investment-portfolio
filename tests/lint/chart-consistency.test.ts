// @vitest-environment node
//
// D12, enforced: charts use the system's tokens, one tooltip, and a text
// alternative, and no component hard-codes a colour.
//
// Parsed with the TypeScript compiler, so comments and prose never trip it.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

const SRC = path.resolve(__dirname, '../../src')

/** Places a literal colour is right: the browser chrome colour has to be a value. */
const LITERAL_COLOUR_ALLOWED = new Set(['app/layout.tsx'])

const COLOUR_LITERAL = /#[0-9a-fA-F]{3}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{8}\b|\brgba?\(\s*\d|\bhsla?\(\s*\d/

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return files(full)
    return entry.name.endsWith('.tsx') ? [full] : []
  })
}

const rel = (file: string) => path.relative(SRC, file).replace(/\\/g, '/')

function parse(file: string) {
  return ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
}

function importsRecharts(source: ts.SourceFile): boolean {
  return source.statements.some(
    (s) => ts.isImportDeclaration(s) && ts.isStringLiteral(s.moduleSpecifier) && s.moduleSpecifier.text === 'recharts',
  )
}

function walk(node: ts.Node, visit: (n: ts.Node) => void) {
  visit(node)
  ts.forEachChild(node, (child) => walk(child, visit))
}

function jsxName(node: ts.JsxOpeningElement | ts.JsxSelfClosingElement): string {
  return node.tagName.getText()
}

function attributeNames(node: ts.JsxOpeningElement | ts.JsxSelfClosingElement): string[] {
  return node.attributes.properties.filter(ts.isJsxAttribute).map((a) => a.name.getText())
}

describe('charts (D12)', () => {
  const all = files(SRC)
  const charts = all.map((file) => ({ file, source: parse(file) })).filter(({ source }) => importsRecharts(source))

  it('finds the chart components', () => {
    expect(charts.length).toBeGreaterThanOrEqual(15)
  })

  it('give every chart a text alternative (ChartFigure)', () => {
    const missing = charts.filter(({ source }) => !source.getFullText().includes('<ChartFigure')).map(({ file }) => rel(file))
    expect(missing).toEqual([])
  })

  it('use the shared tooltip surface: every <Tooltip> has content, none styles itself', () => {
    const problems: string[] = []
    for (const { file, source } of charts) {
      walk(source, (node) => {
        if (!ts.isJsxOpeningElement(node) && !ts.isJsxSelfClosingElement(node)) return
        if (jsxName(node) !== 'Tooltip') return
        const attributes = attributeNames(node)
        const { line } = source.getLineAndCharacterOfPosition(node.getStart())
        if (!attributes.includes('content')) problems.push(`${rel(file)}:${line + 1} <Tooltip> without content`)
        for (const styled of ['contentStyle', 'labelStyle', 'itemStyle', 'wrapperStyle']) {
          if (attributes.includes(styled)) problems.push(`${rel(file)}:${line + 1} <Tooltip ${styled}>`)
        }
      })
    }
    expect(problems).toEqual([])
  })
})

describe('colour (D12)', () => {
  it('no component hard-codes a colour; tokens only', () => {
    const offenders: string[] = []
    for (const file of files(SRC)) {
      if (LITERAL_COLOUR_ALLOWED.has(rel(file))) continue
      const source = parse(file)
      walk(source, (node) => {
        let text: string | null = null
        if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) text = node.text
        else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) text = node.text
        else if (ts.isJsxText(node)) text = null // visible copy, not styling
        if (text && COLOUR_LITERAL.test(text)) {
          const { line } = source.getLineAndCharacterOfPosition(node.getStart())
          offenders.push(`${rel(file)}:${line + 1} ${text.slice(0, 60)}`)
        }
      })
    }
    expect(offenders).toEqual([])
  })
})
