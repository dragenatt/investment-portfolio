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

export type MonteCarloResult = {
  peor: number // worst case
  promedio: number // average
  mejor: number // best case
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

// ── Helper ─────────────────────────────────────────────────────────────────────

function gaussianRandom(mean: number, stddev: number): number {
  const u1 = Math.random()
  const u2 = Math.random()
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
  return mean + z * stddev
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
    capitalAportado > 0 ? (ganancia / capitalAportado) * 100 : 0

  return { historial, capitalAportado, ganancia, valorFinal, rentabilidadTotal }
}

export function simulacionMonteCarlo(
  inicial: number,
  mensual: number,
  años: number,
  rendimientoPromedio: number,
  numSimulaciones: number = 200,
): MonteCarloResult {
  const totalMeses = años * 12
  const resultados: number[] = []

  for (let sim = 0; sim < numSimulaciones; sim++) {
    let valor = inicial
    for (let mes = 1; mes <= totalMeses; mes++) {
      const rendAnual = gaussianRandom(rendimientoPromedio, 0.1)
      const tasaMensual = Math.pow(1 + rendAnual, 1 / 12) - 1
      valor = valor * (1 + tasaMensual) + mensual
    }
    resultados.push(valor)
  }

  resultados.sort((a, b) => a - b)

  const peor = resultados[0]
  const mejor = resultados[resultados.length - 1]
  const promedio =
    resultados.reduce((sum, v) => sum + v, 0) / resultados.length

  return { peor, promedio, mejor }
}

export function probabilidadMeta(
  inicial: number,
  mensual: number,
  años: number,
  rendimientoPromedio: number,
  meta: number,
  numSimulaciones: number = 500,
): number {
  const totalMeses = años * 12
  let exitos = 0

  for (let sim = 0; sim < numSimulaciones; sim++) {
    let valor = inicial
    for (let mes = 1; mes <= totalMeses; mes++) {
      const rendAnual = gaussianRandom(rendimientoPromedio, 0.1)
      const tasaMensual = Math.pow(1 + rendAnual, 1 / 12) - 1
      valor = valor * (1 + tasaMensual) + mensual
    }
    if (valor >= meta) exitos++
  }

  return (exitos / numSimulaciones) * 100
}

export function aporteNecesario(
  meta: number,
  inicial: number,
  años: number,
  rendimiento: number,
): number {
  const r = Math.pow(1 + rendimiento, 1 / 12) - 1
  const n = años * 12
  const crecimientoInicial = inicial * Math.pow(1 + r, n)
  const aporte = (meta - crecimientoInicial) / ((Math.pow(1 + r, n) - 1) / r)
  return aporte
}

export function obtenerRecomendacion(
  prob: number,
  aporteActual: number,
  aporteNecesarioVal: number,
): string {
  if (prob < 50) {
    if (aporteActual < aporteNecesarioVal) {
      return `Tu probabilidad actual es baja (${prob.toFixed(0)}%). Necesitarías aportar al menos $${aporteNecesarioVal.toFixed(0)} mensuales. Considera aumentar tu aporte o extender tu horizonte de inversión.`
    }
    return `Tu probabilidad actual es baja (${prob.toFixed(0)}%). Considera diversificar tu portafolio o ajustar tu meta a un monto más realista.`
  }
  if (prob < 75) {
    return 'Tu meta es alcanzable, pero con riesgo moderado.'
  }
  return 'Alta probabilidad de alcanzar tu meta.'
}
