#!/usr/bin/env node
/**
 * Arma la presentación autocontenida: incrusta las tipografías (OFL) como
 * data URI y los códigos QR compartidos con el póster.
 *
 *   node scripts/presentacion/construir.mjs
 *
 * Entrada:  docs/presentacion/presentacion.src.html   (plantilla editable)
 *           docs/presentacion/qr/*.svg          (generados y verificados aparte)
 * Salida:   docs/presentacion/presentacion-investtracker.html
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const FUENTES = '/mnt/skills/examples/canvas-design/canvas-fonts'
const DIR = join(RAIZ, 'docs', 'presentacion')
const DIR_QR = join(RAIZ, 'docs', 'poster', 'qr') // se reutilizan los del póster

const CARAS = [
  { familia: 'Big Shoulders', archivo: 'BigShoulders-Bold.ttf', peso: 700 },
  { familia: 'Work Sans', archivo: 'WorkSans-Regular.ttf', peso: 400 },
  { familia: 'Work Sans', archivo: 'WorkSans-Bold.ttf', peso: 700 },
  { familia: 'Red Hat Mono', archivo: 'RedHatMono-Regular.ttf', peso: 400 },
]

const bloques = CARAS.map((c) => {
  const ruta = join(FUENTES, c.archivo)
  if (!existsSync(ruta)) throw new Error(`No se encontró la tipografía: ${ruta}`)
  const b64 = readFileSync(ruta).toString('base64')
  return `@font-face{font-family:"${c.familia}";font-style:normal;font-weight:${c.peso};font-display:swap;src:url(data:font/ttf;base64,${b64}) format("truetype")}`
}).join('\n')

let html = readFileSync(join(DIR, 'presentacion.src.html'), 'utf8')

if (!html.includes('/*FUENTES*/')) throw new Error('La plantilla no contiene el marcador /*FUENTES*/')
html = html.replace('/*FUENTES*/', bloques)

// Códigos QR: <!--QR:clave--> se sustituye por el SVG, o por un marcador si no existe
let puestos = 0
let marcadores = 0
html = html.replace(/<!--QR:([a-z]+)-->/g, (_, clave) => {
  const ruta = join(DIR_QR, `${clave}.svg`)
  if (!existsSync(ruta)) {
    marcadores++
    return '<div class="qr-pendiente"><span>Pega aquí<br>el QR</span></div>'
  }
  puestos++
  return readFileSync(ruta, 'utf8').replace('<svg', '<svg class="qr-svg"')
})

writeFileSync(join(DIR, 'presentacion-investtracker.html'), html, 'utf8')
console.log('✓ docs/presentacion/presentacion-investtracker.html')
console.log(`  ${CARAS.length} tipografías · ${puestos} QR incrustados · ${marcadores} marcador(es) pendiente(s)`)
