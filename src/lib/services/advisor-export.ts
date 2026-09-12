// D5 — the plan as a document you can keep. Pure functions, no I/O.
//
// Everything the advisor shows on screen disappears when the tab closes, which
// is a problem for the one artefact a user might reasonably want to reread in a
// year, hand to somebody, or check a decision against.
//
// Two shapes come out of the same structure:
//
//   planAMarkdown  the human document, with the roadmap's mandatory section
//                  headed exactly "Supuestos y limitaciones del modelo".
//   planAJSON      the exact record, unrounded, for anyone who wants to audit
//                  the figures rather than read them.
//
// Two things this file refuses to do. It does not recompute anything: the
// outcome, the sensitivity and the portfolio all arrive from the caller, so an
// exported plan cannot disagree with the screen it was exported from. And it
// does not soften the numbers — the limitations section names inflation, costs
// and taxes as absent, because a nominal gross projection read as if it were
// neither is the single most misleading thing this app can produce.
//
// The download itself reuses downloadFile() in lib/utils/export.ts rather than
// growing a second Blob helper.

import { allocateMoney, roundMoney } from '@/lib/utils/money'
import { formatoMoneda } from './advisor-explain'
import type { PlanParams, PlanOutcome, SensitivityAnalysis } from './advisor'

/** The fields the roadmap lists. A test walks this against the built object. */
export const CAMPOS_REQUERIDOS = [
  'perfil',
  'objetivo',
  'horizonte',
  'capital',
  'aportacion',
  'cartera',
  'rendimiento',
  'volatilidad',
  'probabilidad',
  'escenarios',
  'sensibilidad',
  'recomendaciones',
  'supuestos',
  'fecha',
] as const

export type CampoRequerido = (typeof CAMPOS_REQUERIDOS)[number]

export type FilaCartera = {
  activo: string
  pesoPct: number
  montoInicial: number
  aportacionMensual: number
}

export type Escenario = {
  etiqueta: string
  valorFinal: number
  /** Against what was actually paid in. Negative is a real loss. */
  vsAportado: number
}

export type FilaSensibilidad = {
  valor: number
  esActual: boolean
  medianaFinal: number
  p10Final: number
  probabilidadPct: number
  deltaProbabilidadPp: number
}

export type BloqueSensibilidad = { variable: string; filas: FilaSensibilidad[] }

export type Supuesto = {
  concepto: string
  valor: string
  /** observado / supuesto / convencion — never left to the reader to guess. */
  tipo: string
  fuente: string
}

export type PlanExport = {
  fecha: string
  modelo: { version: string; seed: number; simulaciones: number; meses: number }
  perfil: { nivel: number; nombre: string; descripcion: string }
  objetivo: { monto: number | null; probabilidadObjetivoPct: number }
  horizonte: { años: number; meses: number }
  capital: { inicial: number; aportadoTotal: number }
  aportacion: { mensual: number; necesariaParaObjetivo: number | null }
  cartera: FilaCartera[]
  rendimiento: { anualPct: number; tipo: string; fuente: string }
  volatilidad: { anualPct: number; tipo: string; fuente: string }
  probabilidad: { alcanzarMetaPct: number | null; base: string }
  escenarios: Escenario[]
  sensibilidad: BloqueSensibilidad[] | null
  recomendaciones: string[]
  supuestos: Supuesto[]
  limitaciones: string[]
  advertencia: string
}

export type PlanExportInput = {
  perfil: { nivel: number; nombre: string; descripcion: string }
  params: PlanParams
  meta: number | null
  outcome: PlanOutcome
  /** Asset class to weight, as fractions. */
  cartera: Record<string, number>
  aporteNecesario: number | null
  recomendaciones: string[]
  probabilidadObjetivoPct: number
  sensibilidad: SensitivityAnalysis | null
  /** Injected rather than read from the clock, so an export is reproducible. */
  generadoEn: Date
}

/**
 * The one sentence the roadmap requires, and the one this file exists to make
 * impossible to omit.
 */
export const ADVERTENCIA_PLAN =
  'Esta proyeccion es el resultado de un modelo, no una garantia de resultados. Ninguna de las cifras de este documento esta asegurada, ninguna constituye asesoria de inversion personalizada, y el rendimiento pasado o simulado no predice el futuro.'

/**
 * What the model leaves out entirely.
 *
 * Taken from docs/FINANCIAL_ASSUMPTIONS.md rather than written afresh, so the
 * exported document and the register cannot drift apart.
 */
export const LIMITACIONES_MODELO: readonly string[] = [
  'Inflacion: no modelada. Todas las cifras son nominales, en pesos del año en que ocurren. Un millon dentro de veinte años compra bastante menos que un millon hoy, y esta es la mayor omision del modelo.',
  'Comisiones, spreads y costos de fondo: no modelados. Los rendimientos son brutos, y los costos reales los reducen.',
  'Impuestos: no modelados. No se descuenta ISR sobre ganancias ni retencion sobre intereses o dividendos.',
  'Dividendos: el motor mide rendimiento de precio, no rendimiento total, asi que para activos con dividendo alto el rendimiento historico queda subestimado.',
  'Los rendimientos simulados se sortean de una distribucion normal. Los mercados reales tienen colas mas gruesas: los episodios extremos ocurren mas a menudo de lo que este modelo supone.',
  'El rendimiento y la volatilidad de cada perfil son supuestos de la cartera modelo, no mediciones de tus posiciones reales.',
]

// ─── building ───────────────────────────────────────────────────────────────

export function construirPlanExportable(input: PlanExportInput): PlanExport {
  const { params, outcome, perfil, meta } = input
  const meses = outcome.modelo.meses

  // Split with the largest-remainder method so the rows add back to the total
  // exactly. Multiplying each weight and rounding loses or invents pesos, and a
  // table that does not sum to its own total is the first thing a reader spots.
  const activos = Object.keys(input.cartera)
  const pesos = activos.map((activo) => input.cartera[activo])
  const montosIniciales = allocateMoney(params.capitalInicial, pesos)
  const montosMensuales = allocateMoney(params.aportacionMensual, pesos)
  const pesoTotal = pesos.reduce((sum, peso) => sum + peso, 0)

  const aportado = outcome.proyeccionDeterminista.capitalAportado

  const escenarios: Escenario[] = [
    ['P10 (desfavorable)', outcome.distribucion.p10],
    ['P25', outcome.distribucion.p25],
    ['P50 (mediana)', outcome.distribucion.p50],
    ['P75', outcome.distribucion.p75],
    ['P90 (favorable)', outcome.distribucion.p90],
  ].map(([etiqueta, valorFinal]) => ({
    etiqueta: etiqueta as string,
    valorFinal: valorFinal as number,
    vsAportado: roundMoney((valorFinal as number) - aportado),
  }))

  return {
    fecha: input.generadoEn.toISOString(),
    modelo: {
      version: outcome.modelo.version,
      seed: outcome.modelo.seed,
      simulaciones: outcome.modelo.simulaciones,
      meses,
    },
    perfil,
    objetivo: { monto: meta, probabilidadObjetivoPct: input.probabilidadObjetivoPct },
    horizonte: { años: params.años, meses },
    capital: { inicial: params.capitalInicial, aportadoTotal: aportado },
    aportacion: {
      mensual: params.aportacionMensual,
      necesariaParaObjetivo: input.aporteNecesario,
    },
    cartera: activos.map((activo, i) => ({
      activo,
      pesoPct: pesoTotal > 0 ? (pesos[i] / pesoTotal) * 100 : 0,
      montoInicial: montosIniciales[i],
      aportacionMensual: montosMensuales[i],
    })),
    rendimiento: {
      anualPct: params.rendimientoAnual * 100,
      tipo: 'supuesto',
      fuente: `Cartera modelo del perfil ${perfil.nombre}; ver docs/FINANCIAL_ASSUMPTIONS.md`,
    },
    volatilidad: {
      anualPct: params.volatilidadAnual * 100,
      tipo: 'supuesto',
      fuente: `Cartera modelo del perfil ${perfil.nombre}; ver docs/FINANCIAL_ASSUMPTIONS.md`,
    },
    probabilidad: {
      alcanzarMetaPct: meta === null ? null : outcome.probabilidadMetaPct,
      base: `Fraccion de ${outcome.modelo.simulaciones.toLocaleString('es-MX')} trayectorias simuladas que terminan en la meta o por encima`,
    },
    escenarios,
    sensibilidad: input.sensibilidad ? aplanarSensibilidad(input.sensibilidad) : null,
    recomendaciones: input.recomendaciones,
    supuestos: construirSupuestos(input),
    limitaciones: [...LIMITACIONES_MODELO],
    advertencia: ADVERTENCIA_PLAN,
  }
}

function aplanarSensibilidad(analysis: SensitivityAnalysis): BloqueSensibilidad[] {
  return (Object.keys(analysis) as (keyof SensitivityAnalysis)[]).map((variable) => ({
    variable,
    filas: analysis[variable].map((fila) => ({ ...fila })),
  }))
}

function construirSupuestos(input: PlanExportInput): Supuesto[] {
  const { params, perfil, outcome } = input
  const ref = 'docs/FINANCIAL_ASSUMPTIONS.md'
  return [
    {
      concepto: 'Rendimiento esperado anual',
      valor: `${trim(params.rendimientoAnual * 100)}%`,
      tipo: 'supuesto',
      fuente: `Cartera modelo del perfil ${perfil.nombre}; ${ref}`,
    },
    {
      concepto: 'Volatilidad anual',
      valor: `${trim(params.volatilidadAnual * 100)}%`,
      tipo: 'supuesto',
      fuente: `Cartera modelo del perfil ${perfil.nombre}; ${ref}`,
    },
    {
      concepto: 'Trayectorias simuladas',
      valor: outcome.modelo.simulaciones.toLocaleString('es-MX'),
      tipo: 'convencion',
      fuente: ref,
    },
    {
      concepto: 'Semilla de la simulacion',
      valor: String(outcome.modelo.seed),
      tipo: 'derivado de tus entradas',
      fuente: 'La misma entrada produce el mismo resultado',
    },
    {
      concepto: 'Probabilidad objetivo',
      valor: `${input.probabilidadObjetivoPct}%`,
      tipo: 'supuesto',
      fuente: ref,
    },
    {
      concepto: 'Distribucion de rendimientos',
      valor: 'Normal, con piso en -99% anual',
      tipo: 'supuesto',
      fuente: ref,
    },
    {
      concepto: 'Version del modelo',
      valor: outcome.modelo.version,
      tipo: 'observado',
      fuente: 'docs/ADVISOR_MODEL_VERSIONING.md',
    },
  ]
}

// ─── serialising ────────────────────────────────────────────────────────────

const money = formatoMoneda

function trim(value: number): string {
  return String(Math.round(value * 100) / 100)
}

/** Only the date part; the time an export was clicked is noise in a filename. */
function soloFecha(iso: string): string {
  return iso.slice(0, 10)
}

const ETIQUETA_VARIABLE: Record<string, string> = {
  aportacion: 'Aportacion mensual',
  horizonte: 'Horizonte (años)',
  capital: 'Capital inicial',
  meta: 'Meta',
  rendimiento: 'Rendimiento anual supuesto',
  volatilidad: 'Volatilidad anual supuesta',
}

/**
 * Each swept input printed in its own units.
 *
 * Without this the tables sit "3200", "0.05" and "6400000" next to each other
 * and leave the reader to work out which column is money, which is a rate and
 * which is a count.
 */
const FORMATO_VARIABLE: Record<string, (valor: number) => string> = {
  aportacion: money,
  capital: money,
  meta: money,
  horizonte: (valor) => `${trim(valor)} años`,
  rendimiento: (valor) => `${trim(valor * 100)}%`,
  volatilidad: (valor) => `${trim(valor * 100)}%`,
}

export function planAMarkdown(plan: PlanExport): string {
  const l: string[] = []

  l.push(`# Plan financiero — perfil ${plan.perfil.nombre}`)
  l.push('')
  l.push(`Generado el ${soloFecha(plan.fecha)} · modelo v${plan.modelo.version} · semilla ${plan.modelo.seed}`)
  l.push('')
  l.push(`> ${plan.advertencia}`)
  l.push('')

  l.push('## Perfil')
  l.push('')
  l.push(`**${plan.perfil.nombre}** — ${plan.perfil.descripcion}`)
  l.push('')

  l.push('## Objetivo')
  l.push('')
  l.push(
    plan.objetivo.monto === null
      ? 'No se definio una meta. La proyeccion describe a donde llega el plan, sin juzgarlo contra una cifra.'
      : `Alcanzar ${money(plan.objetivo.monto)}, con una probabilidad objetivo del ${plan.objetivo.probabilidadObjetivoPct}%.`,
  )
  l.push('')

  l.push('## Horizonte')
  l.push('')
  l.push(`${trim(plan.horizonte.años)} años (${plan.horizonte.meses} meses).`)
  l.push('')

  l.push('## Capital y aportacion')
  l.push('')
  l.push(`- Capital inicial: ${money(plan.capital.inicial)}`)
  l.push(`- Aportacion mensual: ${money(plan.aportacion.mensual)}`)
  l.push(`- Total aportado a lo largo del plan: ${money(plan.capital.aportadoTotal)}`)
  if (plan.aportacion.necesariaParaObjetivo !== null) {
    l.push(
      `- Aportacion necesaria para el ${plan.objetivo.probabilidadObjetivoPct}% de probabilidad: ${money(plan.aportacion.necesariaParaObjetivo)}`,
    )
  }
  l.push('')

  l.push('## Cartera sugerida')
  l.push('')
  l.push('| Activo | Peso | Monto inicial | Aportacion mensual |')
  l.push('|---|---:|---:|---:|')
  for (const fila of plan.cartera) {
    l.push(
      `| ${fila.activo} | ${trim(fila.pesoPct)}% | ${money(fila.montoInicial)} | ${money(fila.aportacionMensual)} |`,
    )
  }
  l.push('')

  l.push('## Rendimiento y volatilidad')
  l.push('')
  l.push(`- Rendimiento esperado: **${trim(plan.rendimiento.anualPct)}% anual** — ${plan.rendimiento.tipo}. ${plan.rendimiento.fuente}`)
  l.push(`- Volatilidad: **${trim(plan.volatilidad.anualPct)}% anual** — ${plan.volatilidad.tipo}. ${plan.volatilidad.fuente}`)
  l.push('')

  l.push('## Probabilidad')
  l.push('')
  l.push(
    plan.probabilidad.alcanzarMetaPct === null
      ? 'Sin meta definida no hay probabilidad que calcular.'
      : `**${trim(plan.probabilidad.alcanzarMetaPct)}%** de alcanzar la meta. ${plan.probabilidad.base}.`,
  )
  l.push('')

  l.push('## Escenarios')
  l.push('')
  l.push('| Escenario | Valor final | Frente a lo aportado |')
  l.push('|---|---:|---:|')
  for (const escenario of plan.escenarios) {
    const signo = escenario.vsAportado < 0 ? 'por debajo' : 'por encima'
    l.push(
      `| ${escenario.etiqueta} | ${money(escenario.valorFinal)} | ${money(Math.abs(escenario.vsAportado))} ${signo} |`,
    )
  }
  l.push('')

  l.push('## Sensibilidad')
  l.push('')
  if (!plan.sensibilidad) {
    l.push('La sensibilidad se calcula contra una meta, y este plan no tiene una.')
  } else {
    l.push(
      'Cuanto cambia la probabilidad si se mueve una sola entrada. La fila marcada es el plan tal como esta.',
    )
    l.push('')
    for (const bloque of plan.sensibilidad) {
      const formato = FORMATO_VARIABLE[bloque.variable] ?? trim
      l.push(`### ${ETIQUETA_VARIABLE[bloque.variable] ?? bloque.variable}`)
      l.push('')
      l.push('| Valor | Probabilidad | Cambio | Mediana final |')
      l.push('|---|---:|---:|---:|')
      for (const fila of bloque.filas) {
        const marca = fila.esActual ? ' *(actual)*' : ''
        const delta = fila.esActual ? '—' : `${fila.deltaProbabilidadPp > 0 ? '+' : ''}${trim(fila.deltaProbabilidadPp)} pp`
        l.push(
          `| ${formato(fila.valor)}${marca} | ${trim(fila.probabilidadPct)}% | ${delta} | ${money(fila.medianaFinal)} |`,
        )
      }
      l.push('')
    }
  }

  l.push('## Recomendaciones')
  l.push('')
  if (plan.recomendaciones.length === 0) {
    l.push('Sin recomendaciones adicionales.')
  } else {
    for (const recomendacion of plan.recomendaciones) l.push(`- ${recomendacion}`)
  }
  l.push('')

  // The roadmap requires this heading. Kept verbatim, and a test pins it.
  l.push('## Supuestos y limitaciones del modelo')
  l.push('')
  l.push('### Supuestos')
  l.push('')
  l.push('| Concepto | Valor | Tipo | Fuente |')
  l.push('|---|---|---|---|')
  for (const supuesto of plan.supuestos) {
    l.push(`| ${supuesto.concepto} | ${supuesto.valor} | ${supuesto.tipo} | ${supuesto.fuente} |`)
  }
  l.push('')
  l.push('### Limitaciones')
  l.push('')
  for (const limitacion of plan.limitaciones) l.push(`- ${limitacion}`)
  l.push('')
  l.push(plan.advertencia)
  l.push('')

  return l.join('\n')
}

export function planAJSON(plan: PlanExport): string {
  return JSON.stringify(plan, null, 2)
}

export function nombreArchivoPlan(plan: PlanExport, extension: 'md' | 'json'): string {
  const perfil = plan.perfil.nombre
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return `plan-${perfil || 'financiero'}-${soloFecha(plan.fecha)}.${extension}`
}
