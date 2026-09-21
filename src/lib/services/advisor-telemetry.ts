// D8 — what the advisor records about its own runs.
//
// The roadmap asks for two things that pull against each other: know enough
// about a run to debug it, and record nothing about the user's money that is
// not needed to do so.
//
// The resolution here is that a diagnostic carries only shapes and counts —
// version, simulation count, horizon in months, stage timings, and codes for
// anything wrong. No amount, no goal, no income, not even a projected value. A
// test puts distinctive amounts through the model and proves none of them
// survives anywhere in the serialised record.
//
// The seven conditions the roadmap names are checked with the validators that
// already exist in validation.ts rather than a second set written here. Those
// validators are the project's answer to "no invalid result may reach the
// interface"; this module is the advisor's application of them, plus the two
// checks that only make sense for a Monte Carlo run: a distribution that
// collapsed despite real volatility, and percentiles that came out of order.

import {
  findInvalidNumbers,
  validateProbability,
  validateReturnPct,
  validateVolatility,
  validateWeights,
} from './validation'
import type { PlanOutcome } from './advisor'
import type { Etapa } from './advisor-progress'

export type Severidad = 'aviso' | 'error'

export type CodigoHallazgo =
  | 'probabilidad-invalida'
  | 'retorno-imposible'
  | 'volatilidad-implausible'
  | 'pesos-invalidos'
  | 'numero-invalido'
  | 'monte-carlo-vacio'
  | 'distribucion-degenerada'
  | 'percentiles-desordenados'
  | 'tiempo-anormal'
  | 'etapa-fallida'

export type Hallazgo = {
  codigo: CodigoHallazgo
  severidad: Severidad
  /** Why it fired. Never contains an amount from the plan. */
  detalle: string
  /** Where in the result, when the check found a specific field. */
  ruta?: string
}

/**
 * Past this, a run is slow enough to be worth knowing about.
 *
 * The measured cost of a full analysis is around 200ms, dominated by the
 * contribution solve and the sensitivity sweep. Two seconds is an order of
 * magnitude beyond that: not a slow machine, something wrong.
 */
export const UMBRAL_LENTO_MS = 2_000

export type OpcionesRevision = {
  /** The model portfolio, when there is one to check. */
  cartera?: Record<string, number> | null
  duracionMs?: number | null
}

/**
 * Everything wrong with a result, or an empty list.
 *
 * Detection only — this decides nothing and shows nothing. The caller records
 * it; the interface is protected separately by the sanitiser at the API
 * boundary and by each engine refusing to emit a bad value in the first place.
 */
export function revisarResultado(
  outcome: PlanOutcome,
  opciones: OpcionesRevision = {},
): Hallazgo[] {
  const hallazgos: Hallazgo[] = []
  const añadir = (
    codigo: CodigoHallazgo,
    severidad: Severidad,
    detalle: string,
    ruta?: string,
  ) => hallazgos.push({ codigo, severidad, detalle, ruta })

  // ── NaN and Infinity, anywhere ──────────────────────────────────────────
  // The recursive scan runs first: a non-finite number makes every comparison
  // below meaningless, and knowing where it is matters more than what else it
  // then trips.
  for (const ruta of findInvalidNumbers(outcome)) {
    añadir('numero-invalido', 'error', 'Un número del resultado no es finito.', ruta)
  }

  // ── Probability ─────────────────────────────────────────────────────────
  // Null is not a fault: it is how a plan with no goal reports itself.
  if (outcome.probabilidadMetaPct !== null) {
    const veredicto = validateProbability(outcome.probabilidadMetaPct, { scale: 'percent' })
    if (!veredicto.valid) {
      añadir('probabilidad-invalida', 'error', veredicto.reason!, 'probabilidadMetaPct')
    }
  }

  // ── Returns and volatility ──────────────────────────────────────────────
  const retorno = validateReturnPct(outcome.proyeccionDeterminista.rentabilidadTotalPct)
  if (!retorno.valid) {
    añadir(
      'retorno-imposible',
      'error',
      retorno.reason!,
      'proyeccionDeterminista.rentabilidadTotalPct',
    )
  }

  const volatilidad = validateVolatility(outcome.modelo.volatilidadAnual)
  if (!volatilidad.valid) {
    añadir('volatilidad-implausible', 'error', volatilidad.reason!, 'modelo.volatilidadAnual')
  }

  // ── Weights ─────────────────────────────────────────────────────────────
  if (opciones.cartera) {
    const pesos = Object.values(opciones.cartera)
    if (pesos.length > 0) {
      const veredicto = validateWeights(pesos)
      if (!veredicto.valid) añadir('pesos-invalidos', 'error', veredicto.reason!, 'cartera')
    }
  }

  // ── An empty Monte Carlo ────────────────────────────────────────────────
  if (outcome.modelo.simulaciones <= 0) {
    añadir('monte-carlo-vacio', 'error', 'La simulación no corrio ninguna trayectoria.', 'modelo')
  }
  if (outcome.modelo.meses <= 0) {
    añadir('monte-carlo-vacio', 'error', 'La simulación no corrio ningun mes.', 'modelo')
  }

  // ── A distribution that collapsed ───────────────────────────────────────
  // Every path landing on the same value means the shocks never reached the
  // arithmetic. Legitimate at zero volatility, and a fault at any other.
  const { p10, p25, p50, p75, p90 } = outcome.distribucion
  if (outcome.modelo.volatilidadAnual > 0 && p10 === p90) {
    añadir(
      'distribucion-degenerada',
      'error',
      'Todas las trayectorias terminan en el mismo valor pese a que la volatilidad supuesta no es cero.',
      'distribucion',
    )
  }

  // ── Percentiles out of order ────────────────────────────────────────────
  if (!(p10 <= p25 && p25 <= p50 && p50 <= p75 && p75 <= p90)) {
    añadir(
      'percentiles-desordenados',
      'error',
      'Los percentiles no vienen en orden ascendente.',
      'distribucion',
    )
  }

  // ── Timing ──────────────────────────────────────────────────────────────
  const duracion = opciones.duracionMs
  if (typeof duracion === 'number') {
    if (duracion < 0) {
      añadir('tiempo-anormal', 'aviso', 'La duracion medida es negativa.')
    } else if (duracion > UMBRAL_LENTO_MS) {
      añadir(
        'tiempo-anormal',
        'aviso',
        `La ejecucion tardo mas de ${UMBRAL_LENTO_MS} ms.`,
      )
    }
  }

  return hallazgos
}

export type EtapaRegistrada = { id: string; estado: string; ms: number | null }

export type DiagnosticoAdvisor = {
  version: string
  simulaciones: number
  meses: number
  /** Sum of the stage timings. Null when no stage reported one. */
  duracionMs: number | null
  etapas: EtapaRegistrada[]
  hallazgos: Hallazgo[]
  ok: boolean
}

export type EntradaDiagnostico = {
  outcome: PlanOutcome
  cartera?: Record<string, number> | null
  etapas: Etapa[]
}

/**
 * One record per run: what produced it, how long it took, and what was wrong.
 *
 * Deliberately built from the model block and the stage timings only. Nothing
 * that describes the user's finances goes in — not the capital, not the goal,
 * not a projected value. The codes say what happened; reproducing the run needs
 * the version and the seed, and the seed lives with the plan itself where the
 * user can already see it.
 */
export function construirDiagnostico(entrada: EntradaDiagnostico): DiagnosticoAdvisor {
  const { outcome, etapas } = entrada

  const conTiempo = etapas.filter((etapa) => typeof etapa.ms === 'number')
  const duracionMs =
    conTiempo.length > 0 ? conTiempo.reduce((sum, etapa) => sum + (etapa.ms ?? 0), 0) : null

  const hallazgos = revisarResultado(outcome, {
    cartera: entrada.cartera,
    duracionMs,
  })

  for (const etapa of etapas) {
    if (etapa.estado === 'fallida') {
      hallazgos.push({
        codigo: 'etapa-fallida',
        severidad: 'error',
        detalle: `La etapa ${etapa.id} no termino.`,
        ruta: etapa.id,
      })
    }
  }

  return {
    version: outcome.modelo.version,
    simulaciones: outcome.modelo.simulaciones,
    meses: outcome.modelo.meses,
    duracionMs,
    etapas: etapas.map((etapa) => ({ id: etapa.id, estado: etapa.estado, ms: etapa.ms })),
    hallazgos,
    ok: hallazgos.length === 0,
  }
}

/**
 * The module's only side effect.
 *
 * Silent on a clean run — a log line per successful analysis is noise nobody
 * reads, and noise nobody reads is how a real warning gets missed. One grouped
 * warning when something is actually wrong.
 */
export function registrarDiagnostico(diagnostico: DiagnosticoAdvisor): void {
  if (diagnostico.ok) return
  console.warn('[advisor] resultado con hallazgos', diagnostico)
}
