// ── Types ──────────────────────────────────────────────────────────────────────

export type PerfilNivel = 0 | 1 | 2

export type PerfilNombre = 'Conservador' | 'Moderado' | 'Agresivo'

export type CarteraAsignacion = Record<string, number>

export type ProfileParams = {
  edad: number
  ingresos: number
  riesgo: number // 1-10
  horizonte: number // years
  experiencia: number // 1-4
  estabilidad: number // 1-4
  reaccion: number // 1-4
  porcentajeInversion: number // 0-100
}

export type SimulacionResult = {
  historial: number[] // value at end of each year
  capitalAportado: number // total contributed
  ganancia: number // profit
  valorFinal: number // final portfolio value
  rentabilidadTotal: number // total return %
}

// ── Constants ──────────────────────────────────────────────────────────────────

export const PERFIL_NOMBRES: Record<PerfilNivel, PerfilNombre> = {
  0: 'Conservador',
  1: 'Moderado',
  2: 'Agresivo',
}

export const PERFIL_DESCRIPCIONES: Record<PerfilNombre, string> = {
  Conservador:
    'Buscas seguridad y estabilidad. Prefieres evitar pérdidas y priorizas rendimientos predecibles.',
  Moderado:
    'Buscas equilibrio entre crecimiento y estabilidad. Aceptas cierto riesgo para mejorar rendimientos.',
  Agresivo:
    'Buscas maximizar rendimientos y aceptas volatilidad significativa a cambio de mayor potencial.',
}

export const CARTERAS: Record<PerfilNivel, CarteraAsignacion> = {
  0: { CETES: 0.4, Bonos: 0.3, 'ETF S&P500': 0.2, FIBRAS: 0.1 },
  1: {
    CETES: 0.2,
    Bonos: 0.2,
    'ETF S&P500': 0.35,
    'ETF Nasdaq': 0.15,
    FIBRAS: 0.1,
  },
  2: {
    'ETF S&P500': 0.4,
    'ETF Nasdaq': 0.25,
    'ETF Emergentes': 0.2,
    FIBRAS: 0.1,
    Oro: 0.05,
  },
}

export const RENDIMIENTOS: Record<PerfilNivel, number> = {
  0: 0.04, // 4%
  1: 0.07, // 7%
  2: 0.11, // 11%
}

/**
 * Annual standard deviation assumed for each profile's model portfolio.
 *
 * The previous engine used a flat 0.10 for all three, which is the one number
 * that cannot be right for all of them: it made the conservative portfolio look
 * twice as risky as it is and the aggressive one roughly half.
 *
 * These are modelling assumptions, not measurements, and are recorded as such
 * in docs/FINANCIAL_ASSUMPTIONS.md. The reasoning is the composition in
 * CARTERAS: a book that is 70% short-term government debt cannot swing like an
 * equity one, and an all-equity book carrying emerging markets swings more than
 * a balanced one. They are the parameters most worth replacing with a figure
 * computed from the real holdings once the covariance engine reaches the
 * advisor.
 */
export const VOLATILIDADES: Record<PerfilNivel, number> = {
  0: 0.05, // mostly CETES and bonds
  1: 0.10, // balanced
  2: 0.16, // all equity, including emerging markets
}

// ── Functions ──────────────────────────────────────────────────────────────────

export function perfilPsicologico(
  riesgo: number,
  experiencia: number,
  reaccion: number,
): PerfilNivel {
  const puntaje = riesgo + experiencia * 2 + reaccion * 2
  if (puntaje <= 12) return 0
  if (puntaje <= 20) return 1
  return 2
}

export function capacidadFinanciera(
  edad: number,
  ingresos: number,
  horizonte: number,
  estabilidad: number,
  porcentajeInversion: number,
): PerfilNivel {
  let puntos = 0

  if (edad < 35) puntos += 2
  else if (edad < 55) puntos += 1

  if (ingresos > 50000) puntos += 2
  else if (ingresos > 20000) puntos += 1

  if (horizonte > 7) puntos += 2
  else if (horizonte > 3) puntos += 1

  puntos += estabilidad

  if (porcentajeInversion > 30) puntos += 2
  else if (porcentajeInversion > 10) puntos += 1

  if (puntos <= 4) return 0
  if (puntos <= 8) return 1
  return 2
}

export function obtenerPerfilFinal(params: ProfileParams): {
  nivel: PerfilNivel
  nombre: PerfilNombre
} {
  const psicologico = perfilPsicologico(
    params.riesgo,
    params.experiencia,
    params.reaccion,
  )
  const financiera = capacidadFinanciera(
    params.edad,
    params.ingresos,
    params.horizonte,
    params.estabilidad,
    params.porcentajeInversion,
  )
  const nivel = Math.min(psicologico, financiera) as PerfilNivel
  return { nivel, nombre: PERFIL_NOMBRES[nivel] }
}

export function simulacionInversion(
  inicial: number,
  mensual: number,
  años: number,
  rendimiento: number,
): SimulacionResult {
  const tasaMensual = Math.pow(1 + rendimiento, 1 / 12) - 1
  const totalMeses = años * 12
  const historial: number[] = []

  let valor = inicial
  for (let mes = 1; mes <= totalMeses; mes++) {
    valor = valor * (1 + tasaMensual) + mensual
    if (mes % 12 === 0) {
      historial.push(valor)
    }
  }

  const capitalAportado = inicial + mensual * totalMeses
  const valorFinal = valor
  const ganancia = valorFinal - capitalAportado
  const rentabilidadTotal =
    capitalAportado > 0 ? (ganancia / capitalAportado) * 100 : ganancia > 0 ? 100 : 0

  return { historial, capitalAportado, ganancia, valorFinal, rentabilidadTotal }
}

/**
 * The DETERMINISTIC contribution: the annuity payment that lands exactly on the
 * goal if the expected return is realised every single month.
 *
 * This is a legitimate figure and P0-22 asks for it to be shown, but it is NOT
 * a recommendation. Landing exactly on the mean is roughly a coin flip, so
 * recommending this amount and then scoring it with a simulation is what
 * produced the circular advice the roadmap describes: the advisor suggested an
 * amount and then called that amount insufficient.
 *
 * For a recommendation use aporteParaProbabilidadMeta in services/advisor.ts,
 * which solves against the same simulated paths the probability is measured on.
 */
export function aporteNecesario(
  meta: number,
  inicial: number,
  años: number,
  rendimiento: number,
): number {
  if (años <= 0) return meta - inicial > 0 ? Infinity : 0
  const r = Math.pow(1 + rendimiento, 1 / 12) - 1
  const n = años * 12
  if (r === 0) return n > 0 ? (meta - inicial) / n : Infinity
  const crecimientoInicial = inicial * Math.pow(1 + r, n)
  const factor = (Math.pow(1 + r, n) - 1) / r
  if (factor === 0) return Infinity
  const aporte = (meta - crecimientoInicial) / factor
  return Math.max(0, aporte)
}

/**
 * Wording for the probability result.
 *
 * `aporteSugerido` is the contribution solved against the SAME simulated paths
 * the probability came from, so the two can never contradict each other the way
 * the deterministic annuity solution did. Null means no reachable contribution
 * gets there.
 *
 * Everything here is phrased as an estimate under the current assumptions. The
 * model produces a distribution of scenarios, not a forecast, and the wording
 * has to keep saying so.
 */
export function obtenerRecomendacion(
  prob: number,
  aporteActual: number,
  aporteSugerido: number | null,
): string {
  const p = prob.toFixed(0)

  if (aporteSugerido === null) {
    return `Bajo estos supuestos el modelo estima ${p}% de probabilidad, y ningun aporte razonable alcanza la meta en este plazo. Considera ampliar el horizonte o ajustar la meta.`
  }

  if (aporteSugerido <= aporteActual) {
    return `Con tu aporte actual el modelo estima ${p}% de probabilidad de alcanzar la meta. Ya es suficiente para el objetivo de confianza: no necesitas aportar mas.`
  }

  if (prob < 50) {
    return `El modelo estima ${p}% de probabilidad bajo los supuestos actuales, que es baja. Aportar alrededor de $${aporteSugerido.toFixed(0)} al mes llevaria esa probabilidad al objetivo; extender el plazo o ajustar la meta tiene el mismo efecto.`
  }

  if (prob < 75) {
    return `El modelo estima ${p}% de probabilidad: la meta es alcanzable, pero con un margen estrecho. Aportar alrededor de $${aporteSugerido.toFixed(0)} al mes reduciria esa dependencia del escenario favorable.`
  }

  return `El modelo estima ${p}% de probabilidad de alcanzar la meta bajo los supuestos actuales. Recuerda que es una simulacion, no una garantia.`
}
