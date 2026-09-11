// Why the advisor said what it said — pure functions, no I/O.
//
// advisor.ts produces numbers. This file produces the reasons, and keeps them
// separate on purpose: a projection and an explanation of a projection are
// different claims, and mixing them is how a model result starts reading as
// advice.
//
// Three questions the roadmap asks for, in one module because they share the
// same inputs and are read together:
//
//   D1  Why did I get this recommendation?   — the factors that drove it
//   D2  Can I actually afford this?          — the contribution against income
//   D4  Is investing worth it at all?        — against simply saving
//
// Everything here quotes the user's OWN parameters back. "Your horizon is 20
// years" rather than "a long horizon favours equities": the second is a lecture,
// the first is an explanation.

import { roundMoney } from '@/lib/utils/money'
import type { PlanParams, PlanOutcome } from './advisor'

// ─── D1 — explainability ────────────────────────────────────────────────────

export type FactorId = 'horizonte' | 'riesgo' | 'aportacion' | 'probabilidad' | 'capital'

export type FactorExplicado = {
  id: FactorId
  etiqueta: string
  /** The user's actual figure, formatted for reading. */
  valor: string
  /** Why that figure pushed the recommendation where it went. */
  porque: string
}

export type Explicacion = {
  factores: FactorExplicado[]
  modelo: { version: string; simulaciones: number; seed: number }
  nota: string
}

/** Beyond this a horizon is long enough for volatility to average out somewhat. */
const HORIZONTE_LARGO_AÑOS = 10
/** Below this, a bad year has nowhere to recover from. */
const HORIZONTE_CORTO_AÑOS = 5

/** Above this annual volatility, the ride is genuinely rough. */
const VOLATILIDAD_ALTA = 0.2
const VOLATILIDAD_BAJA = 0.08

const money = (value: number) =>
  new Intl.NumberFormat('es-MX', { maximumFractionDigits: 0 }).format(roundMoney(value))

/**
 * The factors behind a plan, each with the user's number and why it mattered.
 *
 * Null when there is no outcome: an explanation of nothing is worse than
 * silence, because it reads as though a model ran.
 */
export function explicarRecomendacion(
  params: PlanParams,
  outcome: PlanOutcome | null,
  meta: number | null,
): Explicacion | null {
  if (!outcome) return null

  const factores: FactorExplicado[] = []

  factores.push({
    id: 'horizonte',
    etiqueta: 'Horizonte',
    valor: `${params.años} años`,
    porque:
      params.años >= HORIZONTE_LARGO_AÑOS
        ? `Con ${params.años} años por delante, un mal año tiene tiempo de diluirse entre los buenos, y el interes compuesto tiene espacio para hacer la mayor parte del trabajo. Por eso el plan puede permitirse asumir riesgo.`
        : params.años <= HORIZONTE_CORTO_AÑOS
          ? `Con solo ${params.años} años, una caida cerca del final no tiene de donde recuperarse. Ese es el argumento mas fuerte para no asumir mucho riesgo aqui, por bueno que parezca el rendimiento esperado.`
          : `${params.años} años es un plazo intermedio: hay algo de margen para recuperarse de un mal periodo, pero no tanto como para ignorarlo.`,
  })

  factores.push({
    id: 'riesgo',
    etiqueta: 'Riesgo asumido',
    valor: `${(params.volatilidadAnual * 100).toFixed(1)}% de volatilidad anual`,
    porque:
      params.volatilidadAnual >= VOLATILIDAD_ALTA
        ? `Una volatilidad del ${(params.volatilidadAnual * 100).toFixed(1)}% significa que los años malos pueden doler de verdad. El escenario pesimista de este plan (P10) termina en ${money(outcome.perdidaPotencial.escenarioP10)}, y eso es parte del trato, no una posibilidad remota.`
        : params.volatilidadAnual <= VOLATILIDAD_BAJA
          ? `Una volatilidad del ${(params.volatilidadAnual * 100).toFixed(1)}% es baja: el camino sera relativamente tranquilo, y a cambio el rendimiento esperado tambien es modesto. Las dos cosas van juntas siempre.`
          : `Con ${(params.volatilidadAnual * 100).toFixed(1)}% de volatilidad el camino tendra baches. El escenario pesimista termina en ${money(outcome.perdidaPotencial.escenarioP10)}.`,
  })

  factores.push({
    id: 'aportacion',
    etiqueta: 'Aportacion mensual',
    valor: `${money(params.aportacionMensual)} al mes`,
    porque: `Sobre ${params.años} años eso suma ${money(outcome.proyeccionDeterminista.capitalAportado)} de tu bolsillo. Lo que aportas es la unica parte del plan que controlas por completo — el rendimiento no — y por eso suele mover el resultado mas que elegir bien los activos.`,
  })

  factores.push({
    id: 'capital',
    etiqueta: 'Capital inicial',
    valor: money(params.capitalInicial),
    porque:
      params.capitalInicial > 0
        ? `Es el dinero que lleva mas tiempo compuesto, asi que cada peso inicial pesa mas que un peso aportado el ultimo año.`
        : 'Empiezas desde cero, asi que todo el resultado viene de tus aportaciones y del tiempo que las dejes trabajar.',
  })

  const prob = outcome.probabilidadMetaPct
  factores.push({
    id: 'probabilidad',
    etiqueta: 'Probabilidad de alcanzar la meta',
    valor:
      meta === null || prob === null ? 'n/d — sin meta definida' : `${prob.toFixed(0)}%`,
    porque:
      meta === null || prob === null
        ? 'No definiste una meta, asi que no hay nada contra lo que medir la probabilidad. El plan se evalua solo por lo que produce.'
        : prob >= 80
          ? `De ${outcome.modelo.simulaciones.toLocaleString('es-MX')} trayectorias simuladas, el ${prob.toFixed(0)}% llega a ${money(meta)}. Es una probabilidad alta, pero sobre un modelo: no es una garantia.`
          : prob >= 50
            ? `Solo el ${prob.toFixed(0)}% de las trayectorias simuladas llega a ${money(meta)}. Es una moneda razonablemente favorable, no un plan seguro.`
            : `Apenas el ${prob.toFixed(0)}% de las trayectorias llega a ${money(meta)}. Con estos parametros la meta es improbable, y conviene cambiar algo antes que confiar en la suerte.`,
  })

  return {
    factores,
    modelo: {
      version: outcome.modelo.version,
      simulaciones: outcome.modelo.simulaciones,
      seed: outcome.modelo.seed,
    },
    nota: 'Esto explica de donde sale el resultado del modelo con TUS parametros. No es una recomendacion personalizada de inversion: no sabe nada de tu situacion fiscal, tus deudas, tu empleo ni tu tolerancia real a ver el numero bajar.',
  }
}

// ─── D2 — affordability ─────────────────────────────────────────────────────

export type NivelViabilidad = 'comodo' | 'exigente' | 'muy_exigente' | 'inviable' | 'desconocido'

export type BandaViabilidad = {
  /** Inclusive upper bound, as a percentage of income. */
  upTo: number
  nivel: Exclude<NivelViabilidad, 'desconocido'>
  etiqueta: string
}

/**
 * Bands, not a rule.
 *
 * The roadmap is explicit that no universal threshold should be imposed, and it
 * is right: a 30% savings rate is heroic for one household and trivial for
 * another. These describe how demanding a figure IS, and every one of them
 * ships with the note saying the line depends on circumstances this app cannot
 * see.
 */
export const AFFORDABILITY_BANDS: BandaViabilidad[] = [
  { upTo: 15, nivel: 'comodo', etiqueta: 'Comodo' },
  { upTo: 30, nivel: 'exigente', etiqueta: 'Exigente' },
  { upTo: 50, nivel: 'muy_exigente', etiqueta: 'Muy exigente' },
  { upTo: Infinity, nivel: 'inviable', etiqueta: 'Probablemente inviable' },
]

export type Viabilidad = {
  /** What the maths asked for. Never hidden, whatever the verdict. */
  aportacionMatematica: number
  ingresoMensual: number | null
  porcentajeDelIngreso: number | null
  nivel: NivelViabilidad
  etiqueta: string
  advertencia: string | null
  alternativas: string[]
  nota: string
}

const NOTA_SIN_REGLA =
  'No hay una regla universal: lo que para una persona es un esfuerzo razonable para otra es imposible, y esta app no conoce tus gastos fijos, tus deudas ni tu estabilidad laboral. Estas bandas describen que tan exigente es la cifra, no si deberias hacerlo.'

/**
 * The suggested contribution against what the user actually earns.
 *
 * The mathematical figure is always returned untouched. The roadmap says never
 * to hide it and that is the right call: a plan that quietly shrinks the number
 * to something palatable has stopped answering the question that was asked.
 */
export function viabilidadAportacion(
  aportacionMensual: number,
  ingresoMensual: number | null,
): Viabilidad | null {
  if (!Number.isFinite(aportacionMensual)) return null

  const base = {
    aportacionMatematica: aportacionMensual,
    nota: NOTA_SIN_REGLA,
  }

  if (ingresoMensual === null || !Number.isFinite(ingresoMensual) || ingresoMensual <= 0) {
    return {
      ...base,
      ingresoMensual: null,
      porcentajeDelIngreso: null,
      nivel: 'desconocido',
      etiqueta: 'Sin datos de ingreso',
      advertencia: null,
      alternativas: [],
    }
  }

  const porcentaje = (aportacionMensual / ingresoMensual) * 100
  if (!Number.isFinite(porcentaje)) {
    return {
      ...base,
      ingresoMensual,
      porcentajeDelIngreso: null,
      nivel: 'desconocido',
      etiqueta: 'Sin datos de ingreso',
      advertencia: null,
      alternativas: [],
    }
  }

  const banda = AFFORDABILITY_BANDS.find((b) => porcentaje <= b.upTo)!

  const advertencia =
    banda.nivel === 'comodo'
      ? null
      : banda.nivel === 'exigente'
        ? `Aportar ${money(aportacionMensual)} al mes es el ${porcentaje.toFixed(0)}% de tu ingreso. Es sostenible para mucha gente, pero deja poco margen si algo se tuerce: revisa que tengas un fondo de emergencia antes de comprometerte.`
        : banda.nivel === 'muy_exigente'
          ? `Aportar ${money(aportacionMensual)} al mes es el ${porcentaje.toFixed(0)}% de tu ingreso. Eso es mucho. El calculo es correcto, pero mantenerlo durante años requiere que casi nada salga mal.`
          : `La matematica pide ${money(aportacionMensual)} al mes, el ${porcentaje.toFixed(0)}% de tu ingreso. No te lo escondo porque es la respuesta real a lo que preguntaste, pero una cifra asi no se sostiene: conviene cambiar la meta o el plazo antes que intentarlo.`

  // The four ways out, in the roadmap's own order. Offered together rather than
  // ranked, because which one is right depends on things this app cannot see.
  const alternativas =
    banda.nivel === 'comodo'
      ? []
      : [
          'Ampliar el plazo: mas años significa menos dinero al mes para el mismo objetivo, y el interes compuesto hace mas del trabajo.',
          'Reducir la meta: un objetivo mas modesto que si se alcanza vale mas que uno ambicioso que se abandona en el segundo año.',
          'Aumentar los ingresos: es la palanca mas dificil y la mas poderosa, porque no compite con nada de lo anterior.',
          'Modificar la estrategia: mas rendimiento esperado pide menos aportacion, pero trae mas riesgo — no es dinero gratis, es un cambio de trato.',
        ]

  return {
    ...base,
    ingresoMensual,
    porcentajeDelIngreso: porcentaje,
    nivel: banda.nivel,
    etiqueta: banda.etiqueta,
    advertencia,
    alternativas,
  }
}

// ─── D4 — investing versus saving ───────────────────────────────────────────

export type Camino = {
  aportado: number
  valorFinal: number
  /** Value above what was paid in. Zero for the piggy bank, by definition. */
  crecimiento: number
}

export type ComparacionAhorro = {
  ahorro: Camino
  inversion: Camino
  /** The same plan in its pessimistic tenth percentile. */
  inversionPesimista: Camino | null
  diferencia: number
  resumen: string
  advertencia: string
}

/**
 * The same contributions under a mattress and under the plan.
 *
 * Both paths pay in exactly the same money — otherwise the comparison is
 * between two different plans and the gap means nothing.
 *
 * The pessimistic case is included deliberately. The entire difference between
 * saving and investing is that one of them can go wrong, and a comparison that
 * shows only the median hides precisely the thing that makes it a decision.
 */
export function invertirVsAhorrar(
  params: PlanParams,
  outcome: PlanOutcome | null,
): ComparacionAhorro | null {
  if (!outcome) return null

  const aportado = outcome.proyeccionDeterminista.capitalAportado
  if (!Number.isFinite(aportado)) return null

  // No return at all: the money is exactly what was put in.
  const ahorro: Camino = {
    aportado: roundMoney(aportado),
    valorFinal: roundMoney(aportado),
    crecimiento: 0,
  }

  const medianaFinal = outcome.distribucion.p50
  const inversion: Camino = {
    aportado: roundMoney(aportado),
    valorFinal: roundMoney(medianaFinal),
    crecimiento: roundMoney(medianaFinal - aportado),
  }

  const p10 = outcome.distribucion.p10
  const inversionPesimista: Camino | null = Number.isFinite(p10)
    ? {
        aportado: roundMoney(aportado),
        valorFinal: roundMoney(p10),
        crecimiento: roundMoney(p10 - aportado),
      }
    : null

  const diferencia = roundMoney(inversion.valorFinal - ahorro.valorFinal)

  const pesimistaPierde =
    inversionPesimista !== null && inversionPesimista.valorFinal < ahorro.valorFinal

  const resumen = pesimistaPierde
    ? `En el escenario medio, invertir termina en ${money(inversion.valorFinal)} frente a ${money(ahorro.valorFinal)} guardando el dinero sin mas: ${money(diferencia)} de diferencia, y esa diferencia es interes compuesto, no aportaciones. Pero en el escenario pesimista (P10) la inversion termina en ${money(inversionPesimista!.valorFinal)}, PEOR que simplemente ahorrar. Con estos parametros, invertir no es una mejora garantizada: es una apuesta con el viento a favor.`
    : `En el escenario medio, invertir termina en ${money(inversion.valorFinal)} frente a ${money(ahorro.valorFinal)} guardando el dinero sin mas. Son ${money(diferencia)} que no salieron de tu bolsillo: los produjo el interes compuesto sobre las mismas aportaciones.${
        inversionPesimista
          ? ` Incluso en el escenario pesimista (P10) terminarias en ${money(inversionPesimista.valorFinal)}, por encima de lo que habrias ahorrado.`
          : ''
      }`

  return {
    ahorro,
    inversion,
    inversionPesimista,
    diferencia,
    resumen,
    advertencia:
      'Ahorrar sin invertir no tiene riesgo de mercado, pero si tiene inflacion: el dinero guardado pierde poder de compra cada año. Invertir introduce riesgo real — puedes terminar con menos de lo que pusiste — y el rendimiento usado aqui es una ESTIMACION, no una promesa. La comparacion sirve para ver la forma de la decision, no para prometerte el numero de la derecha.',
  }
}
