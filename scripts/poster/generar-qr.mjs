#!/usr/bin/env node
/**
 * Genera los códigos QR del póster como SVG y VERIFICA que sean legibles
 * decodificándolos de vuelta desde un PNG rasterizado.
 *
 *   npm i -D qrcode jsqr pngjs      # dependencias solo de este script
 *   node scripts/poster/generar-qr.mjs
 *
 * Para agregar o cambiar un destino, edita DESTINOS y vuelve a ejecutar.
 * Los SVG ya generados están versionados: solo hace falta correrlo si
 * cambia alguna URL.
 * Salida: docs/poster/qr/<clave>.svg  (se incrustan en poster.src.html)
 */
import QRCode from 'qrcode'
import jsQR from 'jsqr'
import { PNG } from 'pngjs'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const OUT = join(RAIZ, 'docs', 'poster', 'qr')

/** Destinos del póster. `null` = aún sin URL: se dibuja un marcador. */
const DESTINOS = {
  repositorio: 'https://github.com/dragenatt/investment-portfolio',
  aplicacion: 'https://project-tri0w.vercel.app',
  presentacion: null,
  documento: null,
}

const opciones = { errorCorrectionLevel: 'M', margin: 0, color: { dark: '#191539', light: '#0000' } }

mkdirSync(OUT, { recursive: true })

for (const [clave, url] of Object.entries(DESTINOS)) {
  if (!url) {
    console.log(`○ ${clave.padEnd(13)} sin URL — el póster dibuja un marcador`)
    continue
  }

  const svg = await QRCode.toString(url, { ...opciones, type: 'svg' })
  writeFileSync(join(OUT, `${clave}.svg`), svg, 'utf8')

  // Verificación: rasterizar y volver a leer el código
  const buffer = await QRCode.toBuffer(url, { errorCorrectionLevel: 'M', margin: 4, scale: 8 })
  const png = PNG.sync.read(buffer)
  const leido = jsQR(new Uint8ClampedArray(png.data), png.width, png.height)

  if (!leido) throw new Error(`El QR de "${clave}" no se pudo decodificar`)
  if (leido.data !== url) throw new Error(`El QR de "${clave}" apunta a ${leido.data}, no a ${url}`)

  console.log(`✓ ${clave.padEnd(13)} ${url}`)
  console.log(`  verificado: decodifica a la URL correcta (${png.width}×${png.height} px)`)
}
