#!/usr/bin/env node
/**
 * generar-encuestas.mjs
 *
 * Genera el dataset SIMULADO (sintético) de 24 encuestas anónimas sobre
 * InvestTracker + la bitácora de 1 semana de un portafolio simulado por
 * participante.
 *
 * ⚠️  LOS DATOS SON SINTÉTICOS. No provienen de personas reales ni de una
 *     recolección de campo. Sirven para diseñar y probar el tablero de KPIs
 *     antes de aplicar el instrumento a usuarios reales.
 *
 * Determinista: misma semilla => mismos archivos byte a byte.
 *
 *   node scripts/encuestas/generar-encuestas.mjs
 *
 * Salida: docs/research/encuestas-simuladas/data/*.csv
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// ── Configuración ─────────────────────────────────────────────────────────────

const SEMILLA = 20260811
const N = 24
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'research', 'encuestas-simuladas', 'data')

/** Semana observada: lunes 3 → domingo 9 de agosto de 2026. */
const SEMANA = [
  { dia: 1, fecha: '2026-08-03', nombre: 'Lunes', habil: true },
  { dia: 2, fecha: '2026-08-04', nombre: 'Martes', habil: true },
  { dia: 3, fecha: '2026-08-05', nombre: 'Miércoles', habil: true },
  { dia: 4, fecha: '2026-08-06', nombre: 'Jueves', habil: true },
  { dia: 5, fecha: '2026-08-07', nombre: 'Viernes', habil: true },
  { dia: 6, fecha: '2026-08-08', nombre: 'Sábado', habil: false },
  { dia: 7, fecha: '2026-08-09', nombre: 'Domingo', habil: false },
]

/** Factor de mercado común a todos los participantes (desviaciones estándar). */
const FACTOR_MERCADO = { 1: 0.85, 2: -1.35, 3: 0.55, 4: -0.25, 5: 1.05, 6: 0, 7: 0 }

/** Parámetros anuales por perfil, alineados con RENDIMIENTOS de src/lib/utils/investment-profile.ts */
const PARAMS_PERFIL = {
  Conservador: { mu: 0.04, vol: 0.04 },
  Moderado: { mu: 0.07, vol: 0.09 },
  Agresivo: { mu: 0.11, vol: 0.16 },
}

/** Carteras del asesor de la plataforma (CARTERAS en investment-profile.ts). */
const CARTERAS = {
  Conservador: 'CETES 40 / Bonos 30 / ETF S&P500 20 / FIBRAS 10',
  Moderado: 'CETES 20 / Bonos 20 / ETF S&P500 35 / ETF Nasdaq 15 / FIBRAS 10',
  Agresivo: 'ETF S&P500 40 / ETF Nasdaq 25 / ETF Emergentes 20 / FIBRAS 10 / Oro 5',
}

/** Módulos evaluados y su probabilidad de adopción durante la prueba. */
const MODULOS = [
  { clave: 'dashboard', nombre: 'Dashboard', base: 4.45, adopcion: 1.0 },
  { clave: 'portafolios', nombre: 'Portafolios y transacciones', base: 4.3, adopcion: 1.0 },
  { clave: 'analytics', nombre: 'Analytics (riesgo y retornos)', base: 3.75, adopcion: 0.79 },
  { clave: 'mercados', nombre: 'Mercados', base: 4.05, adopcion: 0.88 },
  { clave: 'watchlist', nombre: 'Watchlist', base: 3.95, adopcion: 0.71 },
  { clave: 'alertas', nombre: 'Alertas', base: 3.6, adopcion: 0.63 },
  { clave: 'asesor', nombre: 'Asesor (perfil + simulación)', base: 4.2, adopcion: 0.75 },
  { clave: 'discover', nombre: 'Discover / Social', base: 3.35, adopcion: 0.46 },
]

/** Tareas cronometradas del protocolo de prueba de usabilidad. */
const TAREAS = [
  { clave: 'T1', nombre: 'Crear un portafolio', p: 0.98, seg: 62, disp: 0.30 },
  { clave: 'T2', nombre: 'Registrar una compra', p: 0.96, seg: 95, disp: 0.32 },
  { clave: 'T3', nombre: 'Interpretar P&L y riesgo en Analytics', p: 0.83, seg: 128, disp: 0.38 },
  { clave: 'T4', nombre: 'Crear una alerta de precio', p: 0.88, seg: 84, disp: 0.34 },
  { clave: 'T5', nombre: 'Completar perfil del Asesor y leer la simulación', p: 0.92, seg: 176, disp: 0.30 },
]

/**
 * 24 participantes anónimos. `sat` es el factor latente de satisfacción que
 * hace coherentes entre sí SUS, NPS, CSAT y los comentarios abiertos.
 */
const PARTICIPANTES = [
  { id: 'R01', edad: '18-24', segmento: 'Estudiante universitario', exp: 'Principiante', perfil: 'Conservador', disp: 'Móvil', previa: 'Ninguna', capital: 18000, sat: 0.6,
    positivo: 'El Asesor me dijo en dos minutos qué cartera me corresponde sin que yo supiera de finanzas.',
    mejora: 'No entendí qué es el drawdown ni el Sharpe; me gustaría un "¿qué significa?" junto a cada métrica.', tema: 'educacion_metricas' },
  { id: 'R02', edad: '25-34', segmento: 'Profesional de TI', exp: 'Intermedio', perfil: 'Agresivo', disp: 'Ambos', previa: 'App del bróker', capital: 145000, sat: 1.2,
    positivo: 'Por fin veo todo mi portafolio junto y no repartido entre dos brókers.',
    mejora: 'Las alertas solo se ven dentro de la app; necesito que lleguen al celular aunque esté cerrada.', tema: 'alertas_push' },
  { id: 'R03', edad: '25-34', segmento: 'Docente', exp: 'Principiante', perfil: 'Moderado', disp: 'Móvil', previa: 'Hoja de cálculo', capital: 52000, sat: 0.9,
    positivo: 'Es mucho más rápido que mi hoja de Excel y las gráficas ya vienen hechas.',
    mejora: 'En el celular la tabla de posiciones se corta y tengo que deslizar demasiado.', tema: 'ux_movil' },
  { id: 'R04', edad: '35-44', segmento: 'Contador', exp: 'Avanzado', perfil: 'Moderado', disp: 'Escritorio', previa: 'Hoja de cálculo', capital: 210000, sat: 0.4,
    positivo: 'La exportación a CSV y el detalle de transacciones me sirven para conciliar con mi contabilidad.',
    mejora: 'Registrar dividendos y la retención de impuestos sigue siendo manual.', tema: 'dividendos_impuestos' },
  { id: 'R05', edad: '25-34', segmento: 'Diseñadora', exp: 'Principiante', perfil: 'Conservador', disp: 'Móvil', previa: 'Ninguna', capital: 35000, sat: -0.2,
    positivo: 'La interfaz se ve limpia y el modo oscuro está muy bien logrado.',
    mejora: 'Me perdí en el primer uso; el tour debería explicar la diferencia entre portafolio y watchlist.', tema: 'onboarding' },
  { id: 'R06', edad: '45-59', segmento: 'Empresario', exp: 'Intermedio', perfil: 'Moderado', disp: 'Escritorio', previa: 'Asesor financiero', capital: 380000, sat: 1.0,
    positivo: 'Ver mi rendimiento contra el S&P 500 en la misma gráfica es justo lo que le pedía a mi asesor.',
    mejora: 'La pantalla de Analytics tiene demasiadas gráficas juntas; se leería mejor por secciones.', tema: 'densidad_analytics' },
  { id: 'R07', edad: '18-24', segmento: 'Estudiante universitario', exp: 'Principiante', perfil: 'Agresivo', disp: 'Móvil', previa: 'Ninguna', capital: 15000, sat: 0.2,
    positivo: 'Me enganchó el leaderboard, da curiosidad ver cómo le va a los demás.',
    mejora: 'No me quedó claro qué ven los demás de mi portafolio cuando lo hago público.', tema: 'privacidad_social' },
  { id: 'R08', edad: '25-34', segmento: 'Ingeniero', exp: 'Avanzado', perfil: 'Agresivo', disp: 'Ambos', previa: 'App del bróker', capital: 168000, sat: -0.6,
    positivo: 'Los fundamentales y la señal técnica por símbolo evitan que abra otra aplicación.',
    mejora: 'Los precios a veces tardan en refrescar y no se ve la hora de la última actualización.', tema: 'frescura_precios' },
  { id: 'R09', edad: '35-44', segmento: 'Médica', exp: 'Intermedio', perfil: 'Conservador', disp: 'Móvil', previa: 'Fondo de inversión', capital: 240000, sat: 1.4,
    positivo: 'Las alertas de concentración me hicieron ver que tenía 40% en un solo activo.',
    mejora: 'Manejo cuentas en dólares y pesos; la conversión no siempre queda clara en el total.', tema: 'multidivisa' },
  { id: 'R10', edad: '25-34', segmento: 'Analista de datos', exp: 'Avanzado', perfil: 'Moderado', disp: 'Escritorio', previa: 'Hoja de cálculo', capital: 125000, sat: 1.6,
    positivo: 'La atribución por posición (waterfall) explica el P&L sin que yo tenga que calcular nada.',
    mejora: 'Me gustaría exportar también las métricas de Analytics, no solo posiciones y transacciones.', tema: 'exportacion' },
  { id: 'R11', edad: '45-59', segmento: 'Servidor público', exp: 'Principiante', perfil: 'Conservador', disp: 'Móvil', previa: 'Ninguna', capital: 96000, sat: 0.5,
    positivo: 'Las cifras grandes del panel me dicen en cinco segundos cómo voy.',
    mejora: 'Los botones de la barra inferior son pequeños para mí.', tema: 'ux_movil' },
  { id: 'R12', edad: '25-34', segmento: 'Emprendedora', exp: 'Intermedio', perfil: 'Agresivo', disp: 'Ambos', previa: 'App del bróker', capital: 88000, sat: -0.9,
    positivo: 'Crear el portafolio y cargar doce operaciones me tomó menos de diez minutos.',
    mejora: 'El importador de CSV rechazó el archivo de mi bróker y no me dijo qué columna estaba mal.', tema: 'importacion_csv' },
  { id: 'R13', edad: '35-44', segmento: 'Abogado', exp: 'Principiante', perfil: 'Moderado', disp: 'Escritorio', previa: 'Ninguna', capital: 150000, sat: 1.1,
    positivo: 'El cuestionario del Asesor y la simulación Monte Carlo me dieron una meta concreta de aportación.',
    mejora: 'La simulación debería advertir con más claridad que no es una promesa de rendimiento.', tema: 'educacion_metricas' },
  { id: 'R14', edad: '18-24', segmento: 'Estudiante de posgrado', exp: 'Intermedio', perfil: 'Agresivo', disp: 'Móvil', previa: 'App del bróker', capital: 28000, sat: -0.4,
    positivo: 'La búsqueda de símbolos es rápida y el autocompletado acierta.',
    mejora: 'La primera carga del dashboard con varios portafolios se siente lenta con datos móviles.', tema: 'rendimiento_carga' },
  { id: 'R15', edad: '25-34', segmento: 'Enfermera', exp: 'Principiante', perfil: 'Conservador', disp: 'Móvil', previa: 'Ninguna', capital: 42000, sat: 0.7,
    positivo: 'Registrar una compra es simple: símbolo, cantidad, precio y listo.',
    mejora: 'Al inicio no sabía que había que crear un portafolio antes de registrar algo.', tema: 'onboarding' },
  { id: 'R16', edad: '35-44', segmento: 'Gerente de ventas', exp: 'Intermedio', perfil: 'Moderado', disp: 'Ambos', previa: 'Hoja de cálculo', capital: 195000, sat: 0.8,
    positivo: 'El comparador de portafolios contra un índice me ayudó a decidir dónde aportar.',
    mejora: 'Quiero un resumen semanal por correo, no tener que entrar a buscarlo.', tema: 'alertas_push' },
  { id: 'R17', edad: '45-59', segmento: 'Jubilado', exp: 'Principiante', perfil: 'Conservador', disp: 'Escritorio', previa: 'Fondo de inversión', capital: 320000, sat: -0.1,
    positivo: 'Me tranquiliza ver el dinero invertido y la ganancia separada del capital.',
    mejora: 'Palabras como "benchmark" o "volatilidad" deberían estar en español o explicadas.', tema: 'educacion_metricas' },
  { id: 'R18', edad: '25-34', segmento: 'Científico de datos', exp: 'Avanzado', perfil: 'Agresivo', disp: 'Escritorio', previa: 'Hoja de cálculo', capital: 260000, sat: 1.3,
    positivo: 'Las métricas de riesgo (volatilidad, drawdown, Sharpe) coinciden con las que calculo yo aparte.',
    mejora: 'Falta poder cambiar la ventana temporal de las métricas de riesgo (30/90/365 días).', tema: 'densidad_analytics' },
  { id: 'R19', edad: '35-44', segmento: 'Arquitecta', exp: 'Intermedio', perfil: 'Moderado', disp: 'Móvil', previa: 'App del bróker', capital: 115000, sat: 1.5,
    positivo: 'La tarjeta de ganancia del día me hizo entrar todos los días.',
    mejora: 'En móvil las gráficas de Analytics se ven apretadas y los tooltips tapan los datos.', tema: 'ux_movil' },
  { id: 'R20', edad: '25-34', segmento: 'Community manager', exp: 'Principiante', perfil: 'Moderado', disp: 'Móvil', previa: 'Ninguna', capital: 30000, sat: 0.0,
    positivo: 'El feed de Discover da ideas de qué está comprando la gente.',
    mejora: 'Debería poder seguir a alguien sin que aparezca mi nombre real.', tema: 'privacidad_social' },
  { id: 'R21', edad: '45-59', segmento: 'Consultor', exp: 'Avanzado', perfil: 'Moderado', disp: 'Escritorio', previa: 'Asesor financiero', capital: 410000, sat: 0.3,
    positivo: 'El histórico de valor con snapshots diarios se ve confiable y cuadra con mis estados de cuenta.',
    mejora: 'Los ingresos por dividendos no se proyectan a futuro; el módulo de income se queda corto.', tema: 'dividendos_impuestos' },
  { id: 'R22', edad: '18-24', segmento: 'Estudiante universitario', exp: 'Principiante', perfil: 'Agresivo', disp: 'Móvil', previa: 'Ninguna', capital: 12000, sat: -1.4,
    positivo: 'Es gratis y no me pidió datos bancarios para empezar.',
    mejora: 'Cargar operaciones una por una desde el celular cansa y el CSV desde móvil no fue claro.', tema: 'importacion_csv' },
  { id: 'R23', edad: '35-44', segmento: 'Farmacéutica', exp: 'Intermedio', perfil: 'Conservador', disp: 'Ambos', previa: 'Hoja de cálculo', capital: 175000, sat: 1.7,
    positivo: 'Las alertas de precio funcionaron: me avisó cuando mi ETF bajó al nivel que puse.',
    mejora: 'Mis ETFs están en USD y el total en MXN cambia por el tipo de cambio; quisiera ver ambas cifras.', tema: 'multidivisa' },
  { id: 'R24', edad: '25-34', segmento: 'Ingeniero civil', exp: 'Intermedio', perfil: 'Agresivo', disp: 'Ambos', previa: 'App del bróker', capital: 78000, sat: -0.7,
    positivo: 'El registro semanal me hizo consciente de cuánto muevo la cartera sin necesidad.',
    mejora: 'Al cambiar entre portafolios se recarga todo y pierdo la posición del scroll.', tema: 'rendimiento_carga' },
]

// ── Utilidades deterministas ──────────────────────────────────────────────────

function mulberry32(a) {
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const rand = mulberry32(SEMILLA)

/** Normal estándar por Box-Muller. */
function gauss() {
  let u = 0
  let v = 0
  while (u === 0) u = rand()
  while (v === 0) v = rand()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x))
const enteroEn = (x, lo, hi) => clamp(Math.round(x), lo, hi)
const round = (x, d = 2) => Number(x.toFixed(d))

function csv(filas) {
  return (
    filas
      .map((fila) =>
        fila
          .map((celda) => {
            const s = celda === null || celda === undefined ? '' : String(celda)
            return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
          })
          .join(','),
      )
      .join('\n') + '\n'
  )
}

function escribir(nombre, filas) {
  mkdirSync(OUT, { recursive: true })
  writeFileSync(join(OUT, nombre), csv(filas), 'utf8')
  console.log(`✓ ${nombre} (${filas.length - 1} filas)`)
}

// ── 1. Perfil de los participantes ────────────────────────────────────────────

const perfilFilas = [
  ['id', 'rango_edad', 'segmento', 'experiencia_inversion', 'perfil_riesgo_asesor', 'cartera_sugerida', 'dispositivo_principal', 'herramienta_previa', 'dias_de_prueba', 'capital_inicial_mxn'],
]
for (const p of PARTICIPANTES) {
  perfilFilas.push([p.id, p.edad, p.segmento, p.exp, p.perfil, CARTERAS[p.perfil], p.disp, p.previa, 7, p.capital])
}
escribir('01-participantes.csv', perfilFilas)

// ── 2. Escala SUS (System Usability Scale, 10 ítems, 1-5) ─────────────────────
// Impares = redacción positiva, pares = redacción negativa.

const susFilas = [['id', ...Array.from({ length: 10 }, (_, i) => `sus_${String(i + 1).padStart(2, '0')}`), 'sus_score']]
const susPorId = new Map()
for (const p of PARTICIPANTES) {
  const items = []
  for (let i = 1; i <= 10; i++) {
    const impar = i % 2 === 1
    const base = impar ? 4.05 + 0.55 * p.sat : 1.85 - 0.5 * p.sat
    items.push(enteroEn(base + 0.45 * gauss(), 1, 5))
  }
  let suma = 0
  items.forEach((v, i) => {
    suma += (i + 1) % 2 === 1 ? v - 1 : 5 - v
  })
  const score = round(suma * 2.5, 1)
  susPorId.set(p.id, score)
  susFilas.push([p.id, ...items, score])
}
escribir('02-usabilidad-sus.csv', susFilas)

// ── 3. Experiencia percibida: NPS, CSAT, CES, intención, confianza ────────────
// El NPS se asigna por rango del factor latente para controlar la mezcla
// promotores/pasivos/detractores (12 / 8 / 4) documentada en la metodología.

const ordenados = [...PARTICIPANTES].sort((a, b) => b.sat - a.sat)
const npsPorId = new Map()
ordenados.forEach((p, idx) => {
  let nota
  if (idx < 12) nota = rand() < 0.55 ? 10 : 9
  else if (idx < 20) nota = rand() < 0.5 ? 8 : 7
  else nota = enteroEn(5.2 + 0.8 * gauss(), 3, 6)
  npsPorId.set(p.id, nota)
})

const expFilas = [
  ['id', 'nps_0_10', 'clasificacion_nps', 'csat_1_5', 'ces_facilidad_1_7', 'intencion_continuar_1_5', 'confianza_en_cifras_1_5', 'claridad_visual_1_5', 'velocidad_percibida_1_5', 'recomendaria_a_un_amigo', 'disposicion_pago_mensual_mxn'],
]
for (const p of PARTICIPANTES) {
  const nps = npsPorId.get(p.id)
  const clas = nps >= 9 ? 'Promotor' : nps >= 7 ? 'Pasivo' : 'Detractor'
  const csat = enteroEn(3.75 + 0.7 * p.sat + 0.4 * gauss(), 1, 5)
  const ces = enteroEn(5.25 + 0.85 * p.sat + 0.5 * gauss(), 1, 7)
  const intencion = enteroEn(3.9 + 0.65 * p.sat + 0.35 * gauss(), 1, 5)
  const confianza = enteroEn(3.85 + 0.5 * p.sat + 0.4 * gauss(), 1, 5)
  const claridad = enteroEn(4.15 + 0.45 * p.sat + 0.4 * gauss(), 1, 5)
  const velocidad = enteroEn(3.8 + 0.5 * p.sat + 0.45 * gauss(), 1, 5)
  const pagoBase = [0, 0, 49, 99, 149, 199][enteroEn(1.15 + 1.0 * p.sat + 0.6 * gauss(), 0, 5)]
  expFilas.push([p.id, nps, clas, csat, ces, intencion, confianza, claridad, velocidad, nps >= 7 ? 'Sí' : 'No', pagoBase])
}
escribir('03-experiencia-nps-csat.csv', expFilas)

// ── 4. Adopción y utilidad percibida por módulo (formato largo) ───────────────

const modFilas = [['id', 'modulo_clave', 'modulo', 'lo_uso', 'utilidad_1_5', 'frecuencia_semanal']]
/** Participantes que configuraron alertas: solo ellos las reciben en la bitácora. */
const usanAlertas = new Set()
for (const p of PARTICIPANTES) {
  for (const m of MODULOS) {
    const propension = clamp(m.adopcion + 0.06 * p.sat, 0, 1)
    const usado = rand() < propension
    if (usado && m.clave === 'alertas') usanAlertas.add(p.id)
    if (!usado) {
      modFilas.push([p.id, m.clave, m.nombre, 'No', '', 0])
      continue
    }
    const utilidad = enteroEn(m.base + 0.4 * p.sat + 0.45 * gauss(), 1, 5)
    const frecuencia = enteroEn(utilidad * 1.35 + 0.9 * gauss(), 1, 14)
    modFilas.push([p.id, m.clave, m.nombre, 'Sí', utilidad, frecuencia])
  }
}
escribir('04-adopcion-modulos.csv', modFilas)

// ── 5. Tareas cronometradas (formato largo) ───────────────────────────────────

const factorExp = { Principiante: 1.22, Intermedio: 1.0, Avanzado: 0.84 }
const tareaFilas = [['id', 'tarea', 'descripcion', 'exito', 'segundos', 'errores', 'pidio_ayuda']]
for (const p of PARTICIPANTES) {
  for (const t of TAREAS) {
    const pExito = clamp(t.p + 0.05 * p.sat + (p.exp === 'Avanzado' ? 0.04 : p.exp === 'Principiante' ? -0.05 : 0), 0.4, 0.995)
    const exito = rand() < pExito
    const mult = factorExp[p.exp] * (p.disp === 'Móvil' ? 1.08 : 1) * (exito ? 1 : 1.55)
    const segundos = Math.max(12, Math.round(t.seg * mult * Math.exp(t.disp * gauss())))
    const errores = exito ? (rand() < 0.22 ? 1 : 0) : enteroEn(1.6 + 0.7 * gauss(), 1, 4)
    const ayuda = !exito && rand() < 0.7 ? 'Sí' : errores > 0 && rand() < 0.18 ? 'Sí' : 'No'
    tareaFilas.push([p.id, t.clave, t.nombre, exito ? 1 : 0, segundos, errores, ayuda])
  }
}
escribir('05-tareas-usabilidad.csv', tareaFilas)

// ── 6. Bitácora de 1 semana del portafolio simulado ───────────────────────────
// value_t = value_{t-1} * (1 + r_t) + aportación_t
// El índice TWR (producto acumulado de 1+r) aísla el rendimiento de las
// aportaciones y es la base del drawdown semanal.

/** Días omitidos en el registro, por nivel de satisfacción (prefiere fin de semana). */
function diasOmitidos(sat) {
  if (sat >= 1.2) return []
  if (sat >= 0.4) return [7]
  if (sat >= -0.3) return [6, 7]
  if (sat >= -0.8) return [4, 6, 7]
  return [3, 5, 6, 7]
}

const bitacoraFilas = [
  ['id', 'dia', 'fecha', 'dia_semana', 'mercado', 'registro_completado', 'sesiones', 'minutos_en_app', 'operaciones_registradas', 'aportacion_mxn', 'retorno_dia_pct', 'pnl_dia_mxn', 'valor_portafolio_mxn', 'pnl_acumulado_mxn', 'indice_twr', 'alertas_recibidas', 'alertas_accionadas', 'nota_del_participante'],
]

const NOTAS = {
  positivo: ['Día verde, revisé el panel a la hora de la comida.', 'Subió el ETF del S&P; la tarjeta de ganancia del día lo mostró al instante.', 'Buen día, aproveché para revisar mi asignación.', 'Todo en verde; comparé contra el benchmark.'],
  negativo: ['Día en rojo, entré solo a confirmar que no era error de la app.', 'Bajó el mercado; me sirvió ver el drawdown para no vender.', 'Caída general, revisé la alerta de concentración.', 'Rojo otra vez; leí la sección de riesgo para entenderlo.'],
  cerrado: ['Mercado cerrado, solo revisé el resumen de la semana.', 'Fin de semana: registré una aportación programada.', 'Sin movimientos, día de descanso.', 'Aproveché para leer el módulo del Asesor.'],
  omitido: ['', '', '', ''],
}

const resumenPortafolio = []

for (const p of PARTICIPANTES) {
  const { mu, vol } = PARAMS_PERFIL[p.perfil]
  const muD = mu / 252
  const volD = vol / Math.sqrt(252)
  const omitidos = new Set(diasOmitidos(p.sat))

  let valor = p.capital
  let aportadoTotal = 0
  let twr = 1
  let picoTwr = 1
  let maxDD = 0
  const retornos = []
  let sesionesTotal = 0
  let minutosTotal = 0
  let operacionesTotal = 0
  let alertasRecibidasTotal = 0
  let alertasAccionadasTotal = 0
  let diasRegistrados = 0

  for (const d of SEMANA) {
    const registrado = !omitidos.has(d.dia)

    // Rendimiento del día (el mercado se mueve aunque el participante no registre)
    let r = 0
    if (d.habil) {
      r = muD + volD * (0.8 * FACTOR_MERCADO[d.dia] + 0.6 * gauss())
      retornos.push(r)
    }

    // Aportaciones: quincena del viernes + alguna aportación inicial o de fin de semana
    let aportacion = 0
    if (registrado) {
      if (d.dia === 1 && rand() < 0.35) aportacion = Math.round((p.capital * 0.03) / 100) * 100
      else if (d.dia === 5 && rand() < 0.55) aportacion = Math.round((p.capital * 0.05) / 100) * 100
      else if (!d.habil && rand() < 0.12) aportacion = Math.round((p.capital * 0.02) / 100) * 100
    }

    const pnlDia = valor * r
    valor = valor + pnlDia + aportacion
    aportadoTotal += aportacion

    twr *= 1 + r
    picoTwr = Math.max(picoTwr, twr)
    maxDD = Math.min(maxDD, twr / picoTwr - 1)

    // Actividad en la plataforma
    let sesiones = 0
    let minutos = 0
    let operaciones = 0
    let alertasRec = 0
    let alertasAcc = 0
    let nota = ''

    if (registrado) {
      diasRegistrados++
      const baseSesiones = (d.habil ? 2.1 : 1.2) + 0.55 * p.sat + (p.disp === 'Móvil' ? 0.35 : 0)
      sesiones = enteroEn(baseSesiones + 0.6 * gauss(), 1, 7)
      const baseMin = (d.habil ? 7.5 : 5.0) + 2.6 * p.sat + (p.exp === 'Avanzado' ? 2.2 : 0)
      minutos = round(clamp(baseMin + 2.4 * gauss(), 1.5, 34), 1)
      const propOp = d.habil ? (p.perfil === 'Agresivo' ? 0.62 : p.perfil === 'Moderado' ? 0.45 : 0.3) : 0.12
      operaciones = rand() < propOp ? enteroEn(1.4 + 0.8 * gauss(), 1, 4) : 0
      if (aportacion > 0) operaciones = Math.max(operaciones, 1)
      alertasRec = d.habil && usanAlertas.has(p.id) ? (rand() < 0.62 ? enteroEn(1.3 + 0.6 * gauss(), 1, 3) : 0) : 0
      alertasAcc = alertasRec > 0 ? enteroEn(alertasRec * (0.55 + 0.15 * p.sat), 0, alertasRec) : 0

      const bolsa = !d.habil ? NOTAS.cerrado : r >= 0 ? NOTAS.positivo : NOTAS.negativo
      nota = bolsa[Math.floor(rand() * bolsa.length)]
    }

    sesionesTotal += sesiones
    minutosTotal += minutos
    operacionesTotal += operaciones
    alertasRecibidasTotal += alertasRec
    alertasAccionadasTotal += alertasAcc

    bitacoraFilas.push([
      p.id,
      d.dia,
      d.fecha,
      d.nombre,
      d.habil ? 'Abierto' : 'Cerrado',
      registrado ? 'Sí' : 'No',
      sesiones,
      registrado ? minutos : 0,
      operaciones,
      aportacion,
      round(r * 100, 3),
      Math.round(pnlDia),
      Math.round(valor),
      Math.round(valor - p.capital - aportadoTotal),
      round(twr, 6),
      alertasRec,
      alertasAcc,
      nota,
    ])
  }

  const media = retornos.reduce((a, b) => a + b, 0) / retornos.length
  const varianza = retornos.reduce((a, b) => a + (b - media) ** 2, 0) / (retornos.length - 1)
  const volDiaria = Math.sqrt(varianza)

  resumenPortafolio.push([
    p.id,
    p.perfil,
    p.capital,
    aportadoTotal,
    Math.round(valor),
    Math.round(valor - p.capital - aportadoTotal),
    round((twr - 1) * 100, 3),
    round(volDiaria * 100, 3),
    round(volDiaria * Math.sqrt(252) * 100, 2),
    round(maxDD * 100, 3),
    round(media === 0 ? 0 : (media / volDiaria) * Math.sqrt(252), 2),
    diasRegistrados,
    round((diasRegistrados / 7) * 100, 1),
    sesionesTotal,
    round(minutosTotal, 1),
    operacionesTotal,
    alertasRecibidasTotal,
    alertasAccionadasTotal,
  ])
}

escribir('06-bitacora-semanal.csv', bitacoraFilas)

escribir('07-resumen-portafolio.csv', [
  ['id', 'perfil_riesgo', 'capital_inicial_mxn', 'aportaciones_semana_mxn', 'valor_final_mxn', 'pnl_semana_mxn', 'rendimiento_twr_semana_pct', 'volatilidad_diaria_pct', 'volatilidad_anualizada_pct', 'max_drawdown_semana_pct', 'sharpe_anualizado_aprox', 'dias_registrados', 'adherencia_pct', 'sesiones_semana', 'minutos_semana', 'operaciones_semana', 'alertas_recibidas', 'alertas_accionadas'],
  ...resumenPortafolio,
])

// ── 7. Respuestas abiertas codificadas ────────────────────────────────────────

const comentarioFilas = [['id', 'tipo', 'tema_codificado', 'comentario']]
for (const p of PARTICIPANTES) {
  comentarioFilas.push([p.id, 'Lo que más valoro', 'valor_percibido', p.positivo])
  comentarioFilas.push([p.id, 'Qué mejorarías', p.tema, p.mejora])
}
escribir('08-comentarios-abiertos.csv', comentarioFilas)

console.log(`\nSemilla: ${SEMILLA} · ${N} participantes · semana ${SEMANA[0].fecha} → ${SEMANA[6].fecha}`)
console.log('Datos SIMULADOS: no corresponden a personas reales.')
