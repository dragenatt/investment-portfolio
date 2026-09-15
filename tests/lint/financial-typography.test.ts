// @vitest-environment node
//
// D11 rule, enforced: every rendered financial figure uses .font-financial
// (monospace, tabular figures). See CONTRIBUTING.md.
//
// The TypeScript compiler parses every component; any JSX child expression that
// calls a number formatter must sit inside an element (itself or one of its
// JSX ancestors) whose className mentions font-financial. Formatter calls in
// attributes — aria-label, title, a chart's text summary — are text for screen
// readers and tooltips, not rendered figures, and are not checked.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

const SRC = path.resolve(__dirname, '../../src')

/** Calls that turn a number into displayed text. */
const FORMATTERS = new Set([
  'toFixed',
  'toLocaleString',
  'formatCurrency',
  'formatNumber',
  'formatPercent',
  'formatSignedPercent',
  'formatByUnit',
  'formatoMoneda',
  'formatChartMoney',
  'formatChartPercent',
  'formatChartNumber',
  'pct',
])

/** Components that apply font-financial themselves. */
const FINANCIAL_COMPONENTS = new Set(['FormattedAmount', 'PercentageChange', 'PriceDisplay', 'NumberFlow'])

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return files(full)
    return entry.name.endsWith('.tsx') ? [full] : []
  })
}

function calledName(call: ts.CallExpression): string | null {
  const callee = call.expression
  if (ts.isIdentifier(callee)) return callee.text
  if (ts.isPropertyAccessExpression(callee)) {
    // fmt.format(...) is Intl.NumberFormat.
    if (callee.name.text === 'format' && ts.isIdentifier(callee.expression) && /fmt|formatter/i.test(callee.expression.text)) return 'fmt.format'
    return callee.name.text
  }
  return null
}

function containsFormatter(node: ts.Node): boolean {
  let found = false
  const visit = (n: ts.Node) => {
    if (found) return
    // A nested element is checked on its own; a value computed into a local
    // variable is checked where that variable is rendered, if anywhere.
    if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isVariableDeclaration(n)) return
    if (ts.isCallExpression(n)) {
      const name = calledName(n)
      if (name && (FORMATTERS.has(name) || name === 'fmt.format')) {
        // Dates are not figures.
        const text = n.getText()
        if (!/Date|date|toLocaleDateString|toLocaleTimeString/.test(text)) found = true
      }
    }
    ts.forEachChild(n, visit)
  }
  visit(node)
  return found
}

function tagName(el: ts.JsxElement | ts.JsxSelfClosingElement): string {
  const tag = ts.isJsxElement(el) ? el.openingElement.tagName : el.tagName
  return tag.getText()
}

function hasFinancialClass(el: ts.JsxElement | ts.JsxSelfClosingElement): boolean {
  if (FINANCIAL_COMPONENTS.has(tagName(el))) return true
  const attributes = ts.isJsxElement(el) ? el.openingElement.attributes : el.attributes
  return attributes.properties.some(
    (prop) => ts.isJsxAttribute(prop) && prop.name.getText() === 'className' && prop.getText().includes('font-financial'),
  )
}

/**
 * A number inside a sentence ("con 10,000 simulaciones y 7% anual") stays in the
 * text face: switching faces mid-sentence reads as a glitch. The rule is for
 * figures that stand on their own — values, cells, badges.
 */
function isProse(el: ts.JsxElement): boolean {
  const words = el.children
    .filter(ts.isJsxText)
    .map((child) => child.text)
    .join(' ')
    .match(/[A-Za-zÁÉÍÓÚáéíóúñÑ]{2,}/g)
  return (words?.length ?? 0) >= 3
}

/** The same for a sentence built in an expression: `Se distingue del ruido (t = ${t.toFixed(1)})`. */
function isProseExpression(expression: ts.Expression): boolean {
  let text = ''
  const visit = (n: ts.Node) => {
    if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n)) return
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) text += ` ${n.text}`
    if (ts.isTemplateExpression(n)) {
      text += ` ${n.head.text}`
      for (const span of n.templateSpans) text += ` ${span.literal.text}`
    }
    ts.forEachChild(n, visit)
  }
  visit(expression)
  return (text.match(/[A-Za-zÁÉÍÓÚáéíóúñÑ]{2,}/g)?.length ?? 0) >= 3
}

function offenders(file: string): string[] {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const found: string[] = []
  const visit = (node: ts.Node) => {
    // Only expressions rendered as element children.
    if (
      ts.isJsxExpression(node) &&
      node.expression &&
      ts.isJsxElement(node.parent) &&
      !isProse(node.parent) &&
      !isProseExpression(node.expression) &&
      containsFormatter(node.expression)
    ) {
      let covered = false
      for (let p: ts.Node | undefined = node.parent; p; p = p.parent) {
        if ((ts.isJsxElement(p) || ts.isJsxSelfClosingElement(p)) && hasFinancialClass(p)) {
          covered = true
          break
        }
      }
      if (!covered) {
        const { line } = source.getLineAndCharacterOfPosition(node.getStart())
        found.push(`${path.relative(SRC, file).replace(/\\/g, '/')}:${line + 1} ${node.getText().replace(/\s+/g, ' ').slice(0, 90)}`)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

describe('financial typography (D11)', () => {
  const all = files(SRC)

  it('scans the components', () => {
    expect(all.length).toBeGreaterThan(100)
  })

  it('renders every formatted figure inside .font-financial', () => {
    expect(all.flatMap(offenders)).toEqual([])
  })
})
