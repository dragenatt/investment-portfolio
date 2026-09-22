import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

// The re-audit found 479 words across 62 files with their accents missing in
// text people read — explanations, error messages, labels. The worst was "año"
// written without its ñ: "En el ano", "1 ano", "3 anos" on every asset page.
//
// This guards only the words that have no other correct reading in Spanish, so
// it cannot be wrong about a sentence. Ambiguous ones — "seria"/"sería",
// "perdida"/"pérdida", "publica"/"pública" — need a reader and are left alone.

const ROOTS = ['src/app', 'src/components', 'src/lib'].map((dir) => join(process.cwd(), dir))
// The Spanish dictionary is text people read more than any component — the
// sidebar, every toast, every empty state — and the first pass, reading only
// .ts and .tsx, never opened it: "Configuracion" sat in the navigation.
const DICTIONARY = join(process.cwd(), 'src', 'app', 'dictionaries', 'es.json')

const NEVER_WITHOUT_ACCENT = [
  'ano', 'anos', 'dia', 'dias', 'posicion', 'inversion', 'analisis', 'atribucion', 'asignacion',
  'metricas', 'tambien', 'aqui', 'segun', 'ademas', 'rindio', 'pagina', 'informacion', 'transaccion',
  'accion', 'configuracion', 'descripcion', 'simbolo', 'simbolos', 'estadisticas', 'calificacion',
  'importacion', 'recomendacion', 'busquedas', 'proximamente', 'podras', 'estaran', 'ocurrio', 'salio',
  'rapidas', 'caida', 'caidas', 'raiz', 'tension', 'version', 'util', 'detras', 'ningun', 'algun', 'asi',
  'parametros', 'regresion', 'recesion', 'millon', 'decada', 'decadas', 'tecnologia', 'teoria', 'historicos',
  'historicas', 'debil', 'volatiles', 'movil', 'tamano', 'pequenas', 'anio', 'anios', 'ocurrio', 'volvio',
]

const word = new RegExp(`\\b(${NEVER_WITHOUT_ACCENT.join('|')})\\b`)
// Prose: a string, template or JSX text run with a space in it. A literal with
// no space is a key, an id or a class name, not something a person reads.
const literal = /'([^'\n]*\s[^'\n]*)'|"([^"\n]*\s[^"\n]*)"|`([^`]*\s[^`]*)`|>([^<>{}\n]*\s[^<>{}\n]*)</g

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) walk(path, out)
    else if (/\.(ts|tsx)$/.test(entry)) out.push(path)
  }
  return out
}

/** Template literal text with its ${...} expressions removed: those are code. */
function withoutExpressions(text: string): string {
  let out = ''
  let depth = 0
  for (let i = 0; i < text.length; i++) {
    if (depth === 0 && text.startsWith('${', i)) {
      depth = 1
      i++
      continue
    }
    if (depth > 0) {
      if (text[i] === '{') depth++
      else if (text[i] === '}') depth--
      continue
    }
    out += text[i]
  }
  return out
}

const CODE = /[=;(){}[\]<>`'"]|=>|\bconst\b|\breturn\b|\bimport\b|\bexport\b|\bfunction\b|&&|\|\|/
const TYPE_FIELD = /^[A-Za-z_]\w*\??:\s/

/** A line of plain words, the way wrapped JSX text looks. */
function isProseLine(trimmed: string): boolean {
  if (!trimmed || TYPE_FIELD.test(trimmed) || CODE.test(trimmed)) return false
  return trimmed.split(/\s+/).length >= 4 && /^[A-Za-zÁÉÍÓÚÑáéíóúñ¿¡]/.test(trimmed)
}

function offenders(): string[] {
  const found: string[] = []
  for (const file of ROOTS.flatMap((root) => walk(root))) {
    const lines = readFileSync(file, 'utf8').split('\n')
    lines.forEach((line, index) => {
      const trimmed = line.trim()
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return
      if (line.includes('console.')) return
      // JSX text that wraps across lines has no > and < on the line, so the
      // literal pattern never sees it — which is how "Los periodos de mas de
      // un ano" survived the first pass. A line of plain words in a .tsx file,
      // with no code in it, is that text.
      if (file.endsWith('.tsx') && isProseLine(trimmed)) {
        const hit = word.exec(trimmed)
        if (hit) {
          const where = file.replace(process.cwd(), '').split(String.fromCharCode(92)).join('/')
          found.push(`${where}:${index + 1} "${hit[1]}"`)
        }
        return
      }
      for (const match of line.matchAll(literal)) {
        const text = withoutExpressions(match.slice(1).find((g) => g !== undefined) ?? '')
        const hit = word.exec(text)
        if (hit) {
          const where = file.replace(process.cwd(), '').split(String.fromCharCode(92)).join('/')
          found.push(`${where}:${index + 1} "${hit[1]}"`)
        }
      }
    })
  }
  return found
}

// Case-insensitive here: a dictionary entry is a whole sentence, so the word
// that lost its accent is often the first one — "Ocurrio un error inesperado"
// passed the case-sensitive check twice.
const anyCase = new RegExp(word.source, 'i')

function dictionaryOffenders(): string[] {
  const found: string[] = []
  const visit = (value: unknown, path: string) => {
    if (typeof value === 'string') {
      const hit = anyCase.exec(value)
      if (hit) found.push(`${path} "${hit[1]}"`)
    } else if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) visit(child, path ? `${path}.${key}` : key)
    }
  }
  visit(JSON.parse(readFileSync(DICTIONARY, 'utf8')), '')
  return found
}

describe('text people read keeps its accents', () => {
  it('has no word that is only ever written with one, written without it', () => {
    expect(offenders()).toEqual([])
  })

  it('holds the Spanish dictionary to the same rule', () => {
    expect(dictionaryOffenders()).toEqual([])
  })
})
