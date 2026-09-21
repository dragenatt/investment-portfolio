// D3 — the advisor's teaching half. Pure functions, no I/O.
//
// The roadmap asks for two things that pull in opposite directions: explain the
// eleven ideas the projector rests on, and keep "Resultado del modelo" clearly
// apart from "Explicacion educativa".
//
// The way that separation is enforced here is structural rather than visual.
// Each concept carries two halves:
//
//   the teaching  — definicion / porQueImporta / errorComun. Identical for every
//                   user. It contains no figure from anybody's plan, and a test
//                   pins that: change the plan and not one word may move.
//
//   enTuPlan      — this user's figure for the concept, tagged with where it
//                   came from: something they typed, an assumption the model
//                   makes, an estimate, a result the model produced, or nothing
//                   at all because the concept does not enter this calculation.
//
// So the two claims can never blur into each other, and the fourth of the
// project's standing rules — always distinguish observed data from assumptions
// from estimates from model output — is satisfied per figure rather than by a
// disclaimer at the bottom.
//
// advisor.ts computes. advisor-explain.ts (D1/D2/D4) says why this plan came out
// this way. This file says what the words mean. None of them duplicates another.

import { formatoMoneda } from './advisor-explain'
import type { PlanParams, PlanOutcome } from './advisor'

export type ConceptoId =
  | 'rendimiento-esperado'
  | 'volatilidad'
  | 'interes-compuesto'
  | 'monte-carlo'
  | 'probabilidad'
  | 'percentiles'
  | 'diversificacion'
  | 'horizonte'
  | 'riesgo'
  | 'tasa-libre'
  | 'aportacion'

/** The eleven the roadmap names, in the order they are shown. */
export const CONCEPTOS_REQUERIDOS: readonly ConceptoId[] = [
  'rendimiento-esperado',
  'volatilidad',
  'interes-compuesto',
  'monte-carlo',
  'probabilidad',
  'percentiles',
  'diversificacion',
  'horizonte',
  'riesgo',
  'tasa-libre',
  'aportacion',
] as const

/** Where a figure came from. Never omitted, so nothing can be read as observed. */
export type Procedencia = 'dato' | 'supuesto' | 'estimacion' | 'resultado' | 'no-aplica'

export const PROCEDENCIA_ETIQUETAS: Record<Procedencia, string> = {
  dato: 'Dato que diste',
  supuesto: 'Supuesto del modelo',
  estimacion: 'Estimacion a partir de datos',
  // The roadmap's own wording, kept verbatim.
  resultado: 'Resultado del modelo',
  'no-aplica': 'No entra en este cálculo',
}

export type EnTuPlan = { valor: string; procedencia: Procedencia }

export type ConceptoEducativo = {
  id: ConceptoId
  termino: string
  /** What it means. True for anyone; quotes no figure from any plan. */
  definicion: string
  /** Why it matters when planning. Still free of this user's numbers. */
  porQueImporta: string
  /** The reading that gets people into trouble. */
  errorComun: string
  /** This user's figure, labelled by provenance. */
  enTuPlan: EnTuPlan
}

export type Educacion = {
  conceptos: ConceptoEducativo[]
  aviso: string
}

export type EducacionOpciones = {
  /**
   * An observed risk-free rate, when the caller has one.
   *
   * The advisor's projection does not use a risk-free rate — it compounds a
   * single assumed return — so this stays optional and the concept says so
   * outright when it is absent. Inventing a rate to fill the slot would be the
   * exact thing the project's rules forbid.
   */
  tasaLibre?: { anualPct: number; fuente: string } | null
  /** The model portfolio behind the profile, for the diversification concept. */
  cartera?: Record<string, number> | null
}

// ─── formatting ─────────────────────────────────────────────────────────────

const money = formatoMoneda

/** A fraction as a percentage, without trailing noise: 0.08 -> "8". */
function pct(fraction: number): string {
  return trimNumber(fraction * 100)
}

function trimNumber(value: number): string {
  return String(Math.round(value * 100) / 100)
}

// ─── the teaching, which never varies ───────────────────────────────────────
//
// Deliberately a frozen table rather than strings built at call time: it is the
// cheapest possible guarantee that no plan figure can find its way in.

type Ensenanza = Omit<ConceptoEducativo, 'enTuPlan'>

const ENSENANZAS: Record<ConceptoId, Ensenanza> = {
  'rendimiento-esperado': {
    id: 'rendimiento-esperado',
    termino: 'Rendimiento esperado',
    definicion:
      'El promedio anual que se supone que ganara el dinero invertido. Es un punto de partida del modelo, no una medicion de lo que ya paso ni una promesa de lo que pasara.',
    porQueImporta:
      'Es la palanca mas fuerte de toda la proyección. Mover un solo punto porcentual cambia el resultado a largo plazo mucho mas que subir la aportación, y por eso importa de donde sale la cifra.',
    errorComun:
      'Leerlo como el rendimiento de cada año. Un promedio admite años muy buenos y años muy malos; casi ningun año se parece al promedio, y esa diferencia es justamente la volatilidad.',
  },
  volatilidad: {
    id: 'volatilidad',
    termino: 'Volatilidad',
    definicion:
      'Cuanto se aparta el rendimiento real de su promedio, medida como desviación estándar anual. Describe el tamaño típico del vaiven, no su dirección.',
    porQueImporta:
      'Dos planes con el mismo rendimiento esperado y distinta volatilidad no son el mismo plan: el mas volátil tiene una cola de resultados malos mucho mas larga, y esa cola decide si el plan se aguanta.',
    errorComun:
      'Confundirla con pérdida. Volatilidad alta significa movimientos grandes en las dos direcciones; lo que la vuelve peligrosa es que empuja a vender en el peor momento.',
  },
  'interes-compuesto': {
    id: 'interes-compuesto',
    termino: 'Interes compuesto',
    definicion:
      'El rendimiento se calcula sobre el dinero ya acumulado, no solo sobre lo aportado. Cada periodo arranca desde una base mayor, asi que el crecimiento se acelera con el tiempo.',
    porQueImporta:
      'Es la razón por la que el plazo pesa mas que el monto. Los últimos tramos de un horizonte largo aportan mucho mas valor que los primeros, aunque la aportación mensual sea la misma.',
    errorComun:
      'Suponer que el efecto es lineal, y que solo funciona hacia arriba. Una caida también compone, y recuperarla exige un porcentaje mayor que el que se perdio.',
  },
  'monte-carlo': {
    id: 'monte-carlo',
    termino: 'Simulación de Monte Carlo',
    definicion:
      'En lugar de proyectar un único camino, el modelo sortea miles de secuencias de rendimientos y observa como termina cada una. El resultado es un abanico de finales posibles, no una linea.',
    porQueImporta:
      'Un solo camino esconde el rango. El abanico muestra cuanto puede separarse el mejor caso del peor bajo los mismos supuestos, que es la información que hace falta para decidir.',
    errorComun:
      'Tomar el abanico por todo lo que puede pasar. Solo contiene lo que los supuestos permiten: si el rendimiento o la volatilidad supuestos estan mal, todas las trayectorias lo estan a la vez.',
  },
  probabilidad: {
    id: 'probabilidad',
    termino: 'Probabilidad de alcanzar la meta',
    definicion:
      'La fraccion de trayectorias simuladas que terminan en la meta o por encima. Se mide dentro del modelo, contando escenarios, no observando el mercado.',
    porQueImporta:
      'Convierte una meta en algo comparable: permite juzgar dos planes por cuantas veces funcionan y no por lo bien que se ven en su caso medio.',
    errorComun:
      'Leerla como una probabilidad del mundo real. Es condicional a los supuestos; si el rendimiento supuesto no se cumple, la cifra tampoco.',
  },
  percentiles: {
    id: 'percentiles',
    termino: 'Percentiles',
    definicion:
      'Cortes del abanico ordenado de peor a mejor. El corte bajo deja por debajo a la decima parte de las trayectorias; la mediana lo parte por la mitad.',
    porQueImporta:
      'Describen la forma del resultado y no solo su centro. La distancia entre el corte bajo y el alto es la incertidumbre del plan, expresada en dinero.',
    errorComun:
      'Tratar el corte bajo como el peor caso posible. Es solo el limite de la zona desfavorable que se simulo; por debajo queda una fraccion de trayectorias todavía peores.',
  },
  diversificacion: {
    id: 'diversificacion',
    termino: 'Diversificacion',
    definicion:
      'Repartir el dinero entre activos que no se mueven al mismo tiempo. Lo que reduce no es el rendimiento esperado, sino la magnitud del vaiven conjunto.',
    porQueImporta:
      'Es la única forma conocida de bajar el riesgo sin renunciar en la misma proporcion al rendimiento, y depende de como se relacionan entre si los activos, no de cuantos hay.',
    errorComun:
      'Contar posiciones. Varios fondos del mismo índice son una sola apuesta repetida; dos activos que suelen moverse al reves diversifican mucho mas que diez que se mueven juntos.',
  },
  horizonte: {
    id: 'horizonte',
    termino: 'Horizonte',
    definicion:
      'El tiempo que el dinero puede quedarse invertido sin que haga falta retirarlo. Se cuenta hasta el momento en que se necesita, no hasta que se pierde la paciencia.',
    porQueImporta:
      'Fija cuanto puede trabajar el interes compuesto y cuanto margen hay para recuperarse de un mal tramo. Es lo que decide que nivel de riesgo tiene sentido asumir.',
    errorComun:
      'Dar por hecho que un plazo largo elimina el riesgo. Reduce la probabilidad de terminar en pérdida, pero agranda la desviación posible medida en dinero.',
  },
  riesgo: {
    id: 'riesgo',
    termino: 'Riesgo',
    definicion:
      'La posibilidad de terminar con menos de lo que hacia falta, y el tamaño de ese faltante. No es lo mismo que la volatilidad: la volatilidad lo describe, el riesgo lo valora.',
    porQueImporta:
      'Un plan solo es viable si su rama mala sigue siendo soportable. Mirar unicamente el caso medio deja fuera justo la parte que puede obligar a abandonarlo a mitad de camino.',
    errorComun:
      'Medirlo por lo que se siente en un mes malo. El riesgo que cuenta es el de no llegar, y a veces la decisión mas arriesgada resulta ser quedarse fuera.',
  },
  'tasa-libre': {
    id: 'tasa-libre',
    termino: 'Tasa libre de riesgo',
    definicion:
      'El rendimiento que se obtiene sin asumir riesgo de mercado, tipicamente deuda pública de corto plazo. Es la referencia contra la que se juzga cualquier otro rendimiento.',
    porQueImporta:
      'Solo la parte que supera esa referencia es paga por asumir riesgo. En esta app la tasa libre entra en las métricas de riesgo de tu cartera, como el Sharpe y el Sortino, no en este proyector.',
    errorComun:
      'Tomarla por cero. Cuando la tasa sin riesgo es alta, buena parte del rendimiento de una cartera no es merito de la estrategia sino del entorno.',
  },
  aportacion: {
    id: 'aportacion',
    termino: 'Aportacion',
    definicion:
      'El dinero nuevo que entra cada periodo. Es la única variable del plan que se controla por completo, a diferencia del rendimiento.',
    porQueImporta:
      'En los primeros tramos del plan aporta mas al saldo que el rendimiento, y no depende de que el mercado coopere. Es también la palanca que primero se rompe si no se puede sostener.',
    errorComun:
      'Subirla hasta que la proyección muestre la cifra deseada. La aportación que hace cuadrar el número solo sirve si se puede pagar todos los meses del horizonte.',
  },
}

// ─── the plan-specific half ─────────────────────────────────────────────────

/**
 * The eleven concepts, each paired with this user's own figure for it.
 *
 * Null when there is no outcome: a glossary attached to nothing invites the
 * reader to assume a model ran when none did.
 */
export function explicacionEducativa(
  params: PlanParams,
  outcome: PlanOutcome | null,
  meta: number | null,
  opciones?: EducacionOpciones,
): Educacion | null {
  if (!outcome) return null

  const { distribucion, modelo, proyeccionDeterminista, perdidaPotencial } = outcome
  const cartera = opciones?.cartera ?? null
  const tasaLibre = opciones?.tasaLibre ?? null

  const enTuPlan: Record<ConceptoId, EnTuPlan> = {
    'rendimiento-esperado': {
      valor: `${pct(params.rendimientoAnual)}% anual`,
      procedencia: 'supuesto',
    },
    volatilidad: {
      valor: `${pct(params.volatilidadAnual)}% anual`,
      procedencia: 'supuesto',
    },
    'interes-compuesto': {
      // Both halves named. Showing only the growth would flatter the plan.
      valor: `Aportas ${money(proyeccionDeterminista.capitalAportado)} · el interes pone ${money(proyeccionDeterminista.ganancia)}`,
      procedencia: 'resultado',
    },
    'monte-carlo': {
      valor: `${modelo.simulaciones.toLocaleString('es-MX')} trayectorias · ${modelo.meses} meses · semilla ${modelo.seed}`,
      procedencia: 'resultado',
    },
    probabilidad:
      meta !== null && outcome.probabilidadMetaPct !== null
        ? {
            valor: `${trimNumber(outcome.probabilidadMetaPct)}% de las trayectorias llegan a la meta`,
            procedencia: 'resultado',
          }
        : {
            valor: 'Sin meta definida, no hay probabilidad que contar',
            procedencia: 'no-aplica',
          },
    percentiles: {
      valor: `P10 ${money(distribucion.p10)} · P25 ${money(distribucion.p25)} · P50 ${money(distribucion.p50)} · P75 ${money(distribucion.p75)} · P90 ${money(distribucion.p90)}`,
      procedencia: 'resultado',
    },
    diversificacion: describirCartera(cartera),
    horizonte: {
      valor: `${trimNumber(params.años)} años (${modelo.meses} meses)`,
      procedencia: 'dato',
    },
    riesgo: {
      // The sign is the whole meaning here, and a signed figure on its own does
      // not carry it: "$869,771 frente a lo aportado" reads equally like a gain
      // and like a shortfall. Say the side in words and print the magnitude.
      valor: `En el escenario P10 terminas con ${money(perdidaPotencial.escenarioP10)}, ${money(Math.abs(perdidaPotencial.vsAportado))} ${perdidaPotencial.vsAportado < 0 ? 'por debajo' : 'por encima'} de lo aportado`,
      procedencia: 'resultado',
    },
    'tasa-libre': describirTasaLibre(tasaLibre),
    aportacion: {
      valor: `${money(params.aportacionMensual)} al mes`,
      procedencia: 'dato',
    },
  }

  return {
    conceptos: CONCEPTOS_REQUERIDOS.map((id) => ({
      ...ENSENANZAS[id],
      enTuPlan: enTuPlan[id],
    })),
    aviso:
      'Esta seccion explica los conceptos que usa el proyector. Es material educativo: no cambia ninguna cifra de las de arriba, y ninguna de estas definiciones es una recomendacion de inversión.',
  }
}

function describirCartera(cartera: Record<string, number> | null): EnTuPlan {
  if (!cartera) {
    return { valor: 'No se indico una cartera para este plan', procedencia: 'no-aplica' }
  }

  const pesos = Object.values(cartera).filter((peso) => Number.isFinite(peso) && peso > 0)
  if (pesos.length === 0) {
    return { valor: 'No se indico una cartera para este plan', procedencia: 'no-aplica' }
  }

  const total = pesos.reduce((sum, peso) => sum + peso, 0)
  const mayor = Math.max(...pesos)
  const cuota = total > 0 ? (mayor / total) * 100 : 0

  return {
    // The count and the concentration together: five classes where one holds
    // most of the money is not the same book as five even ones, and the count
    // on its own would not say which this is.
    valor: `${pesos.length} clases de activo · la mayor pesa ${trimNumber(cuota)}%`,
    procedencia: 'supuesto',
  }
}

function describirTasaLibre(
  tasaLibre: { anualPct: number; fuente: string } | null,
): EnTuPlan {
  if (!tasaLibre || !Number.isFinite(tasaLibre.anualPct)) {
    return {
      valor: 'No entra en esta proyección: el modelo compone un solo rendimiento supuesto',
      procedencia: 'no-aplica',
    }
  }
  return {
    valor: `${trimNumber(tasaLibre.anualPct)}% anual · ${tasaLibre.fuente}`,
    procedencia: 'dato',
  }
}
