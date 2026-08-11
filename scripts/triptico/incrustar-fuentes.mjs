#!/usr/bin/env node
/**
 * Incrusta las tipografías (OFL) como data URI en el tríptico, para que la
 * pieza sea un solo archivo autocontenido y se vea igual en cualquier equipo.
 *
 *   node scripts/triptico/incrustar-fuentes.mjs
 *
 * Entrada:  docs/marketing/triptico.src.html   (plantilla editable)
 * Salida:   docs/marketing/triptico-investtracker.html
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const FUENTES = '/mnt/skills/examples/canvas-design/canvas-fonts'

const CARAS = [
  { familia: 'Big Shoulders', archivo: 'BigShoulders-Bold.ttf', peso: 700, estilo: 'normal' },
  { familia: 'Work Sans', archivo: 'WorkSans-Regular.ttf', peso: 400, estilo: 'normal' },
  { familia: 'Work Sans', archivo: 'WorkSans-Bold.ttf', peso: 700, estilo: 'normal' },
  { familia: 'Red Hat Mono', archivo: 'RedHatMono-Regular.ttf', peso: 400, estilo: 'normal' },
]

const bloques = CARAS.map((c) => {
  const ruta = join(FUENTES, c.archivo)
  if (!existsSync(ruta)) throw new Error(`No se encontró la tipografía: ${ruta}`)
  const b64 = readFileSync(ruta).toString('base64')
  return `@font-face{font-family:"${c.familia}";font-style:${c.estilo};font-weight:${c.peso};font-display:swap;src:url(data:font/ttf;base64,${b64}) format("truetype")}`
}).join('\n')

const src = join(RAIZ, 'docs', 'marketing', 'triptico.src.html')
const dest = join(RAIZ, 'docs', 'marketing', 'triptico-investtracker.html')
const html = readFileSync(src, 'utf8')

if (!html.includes('/*FUENTES*/')) throw new Error('La plantilla no contiene el marcador /*FUENTES*/')

writeFileSync(dest, html.replace('/*FUENTES*/', bloques), 'utf8')
const kb = (Buffer.byteLength(bloques) / 1024).toFixed(0)
console.log(`✓ ${dest}`)
console.log(`  ${CARAS.length} tipografías incrustadas (${kb} KB) · licencias OFL en ${FUENTES}`)
