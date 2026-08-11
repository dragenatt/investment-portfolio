#!/usr/bin/env node
/**
 * calcular-kpis.mjs
 *
 * Lee los CSV de docs/research/encuestas-simuladas/data/ y calcula el tablero
 * de KPIs (usabilidad, satisfacción, adopción, eficiencia, engagement y
 * desempeño del portafolio simulado).
 *
 * No depende de cómo se generaron los CSV: si mañana se sustituyen por
 * respuestas reales con el mismo esquema, los KPIs se recalculan igual.
 *
 *   node scripts/encuestas/calcular-kpis.mjs
 *
 * Salida: data/kpis.json y data/tablas-kpi.md
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'research', 'encuestas-simuladas', 'data')

// ── Lectura de CSV ────────────────────────────────────────────────────────────

function leerCsv(nombre) {
  const texto = readFileSync(join(DATA, nombre), 'utf8').replace(/\r\n/g, '\n').trimEnd()
  const filas = []
  let campo = ''
  let fila = []
  let enComillas = false
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i]
    if (enComillas) {
      if (c === '"') {
        if (texto[i + 1] === '"') {
          campo += '"'
          i++
        } else enComillas = false
      } else campo += c
    } else if (c === '"') enComillas = true
    else if (c === ',') {
      fila.push(campo)
      campo = ''
    } else if (c === '\n') {
      fila.push(campo)
      filas.push(fila)
      fila = []
      campo = ''
    } else campo += c
  }
  fila.push(campo)
  filas.push(fila)
  const encabezado = filas.shift()
  return filas.map((f) => Object.fromEntries(encabezado.map((h, i) => [h, f[i] ?? ''])))
}

// ── Estadística ───────────────────────────────────────────────────────────────

const num = (v) => (v === '' || v === undefined ? null : Number(v))
const suma = (xs) => xs.reduce((a, b) => a + b, 0)
const media = (xs) => (xs.length ? suma(xs) / xs.length : 0)
const r = (x, d = 1) => Number(Number(x).toFixed(d))

function desvest(xs) {
  if (xs.length < 2) return 0
  const m = media(xs)
  return Math.sqrt(suma(xs.map((x) => (x - m) ** 2)) / (xs.length - 1))
}

function mediana(xs) {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

function percentil(xs, p) {
  const s = [...xs].sort((a, b) => a - b)
  const idx = (s.length - 1) * p
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (idx - lo)
}

/** Intervalo de confianza al 95% de la media (t≈2.07 para n=24). */
function ic95(xs) {
  const t = 2.069
  const e = (t * desvest(xs)) / Math.sqrt(xs.length)
  return [r(media(xs) - e, 2), r(media(xs) + e, 2)]
}

function agrupar(filas, clave) {
  const mapa = new Map()
  for (const f of filas) {
    const k = f[clave]
    if (!mapa.has(k)) mapa.set(k, [])
    mapa.get(k).push(f)
  }
  return mapa
}

// ── Carga ─────────────────────────────────────────────────────────────────────

const participantes = leerCsv('01-participantes.csv')
const sus = leerCsv('02-usabilidad-sus.csv')
const exp = leerCsv('03-experiencia-nps-csat.csv')
const modulos = leerCsv('04-adopcion-modulos.csv')
const tareas = leerCsv('05-tareas-usabilidad.csv')
const bitacora = leerCsv('06-bitacora-semanal.csv')
const resumen = leerCsv('07-resumen-portafolio.csv')
const comentarios = leerCsv('08-comentarios-abiertos.csv')

const n = participantes.length
const porId = new Map(participantes.map((p) => [p.id, p]))

// ── KPI 1 · Usabilidad (SUS) ──────────────────────────────────────────────────

const susScores = sus.map((f) => num(f.sus_score))
function gradoSus(x) {
  if (x >= 84.1) return 'A (excelente)'
  if (x >= 78.9) return 'B (bueno)'
  if (x >= 72.6) return 'C (aceptable)'
  if (x >= 62.7) return 'D (marginal)'
  return 'F (deficiente)'
}
const kpiSus = {
  media: r(media(susScores), 1),
  mediana: r(mediana(susScores), 1),
  desvest: r(desvest(susScores), 1),
  ic95: ic95(susScores),
  min: Math.min(...susScores),
  max: Math.max(...susScores),
  grado: gradoSus(media(susScores)),
  pct_sobre_68: r((susScores.filter((x) => x >= 68).length / n) * 100, 1),
  por_experiencia: Object.fromEntries(
    [...agrupar(sus.map((f) => ({ ...f, exp: porId.get(f.id).experiencia_inversion })), 'exp')].map(([k, v]) => [
      k,
      { n: v.length, media: r(media(v.map((f) => num(f.sus_score))), 1) },
    ]),
  ),
  por_dispositivo: Object.fromEntries(
    [...agrupar(sus.map((f) => ({ ...f, d: porId.get(f.id).dispositivo_principal })), 'd')].map(([k, v]) => [
      k,
      { n: v.length, media: r(media(v.map((f) => num(f.sus_score))), 1) },
    ]),
  ),
}

// ── KPI 2 · Satisfacción y lealtad ────────────────────────────────────────────

const notasNps = exp.map((f) => num(f.nps_0_10))
const promotores = notasNps.filter((x) => x >= 9).length
const pasivos = notasNps.filter((x) => x >= 7 && x <= 8).length
const detractores = notasNps.filter((x) => x <= 6).length
const csat = exp.map((f) => num(f.csat_1_5))
const ces = exp.map((f) => num(f.ces_facilidad_1_7))
const intencion = exp.map((f) => num(f.intencion_continuar_1_5))
const pago = exp.map((f) => num(f.disposicion_pago_mensual_mxn))

const kpiSatisfaccion = {
  nps: r(((promotores - detractores) / n) * 100, 1),
  promotores,
  pasivos,
  detractores,
  pct_promotores: r((promotores / n) * 100, 1),
  pct_detractores: r((detractores / n) * 100, 1),
  nps_media_nota: r(media(notasNps), 2),
  csat_media: r(media(csat), 2),
  csat_top2_pct: r((csat.filter((x) => x >= 4).length / n) * 100, 1),
  ces_media: r(media(ces), 2),
  intencion_continuar_media: r(media(intencion), 2),
  intencion_top2_pct: r((intencion.filter((x) => x >= 4).length / n) * 100, 1),
  confianza_cifras_media: r(media(exp.map((f) => num(f.confianza_en_cifras_1_5))), 2),
  claridad_visual_media: r(media(exp.map((f) => num(f.claridad_visual_1_5))), 2),
  velocidad_percibida_media: r(media(exp.map((f) => num(f.velocidad_percibida_1_5))), 2),
  disposicion_pago: {
    pct_dispuesto: r((pago.filter((x) => x > 0).length / n) * 100, 1),
    arpu_potencial_mxn: r(media(pago), 1),
    ticket_medio_entre_dispuestos_mxn: r(media(pago.filter((x) => x > 0)), 1),
  },
}

// ── KPI 3 · Adopción y utilidad por módulo ────────────────────────────────────

const kpiModulos = [...agrupar(modulos, 'modulo_clave')].map(([clave, filas]) => {
  const usados = filas.filter((f) => f.lo_uso === 'Sí')
  const utilidades = usados.map((f) => num(f.utilidad_1_5))
  return {
    clave,
    modulo: filas[0].modulo,
    adopcion_pct: r((usados.length / n) * 100, 1),
    usuarios: usados.length,
    utilidad_media: usados.length ? r(media(utilidades), 2) : null,
    utilidad_top2_pct: usados.length ? r((utilidades.filter((x) => x >= 4).length / usados.length) * 100, 1) : null,
    frecuencia_semanal_media: usados.length ? r(media(usados.map((f) => num(f.frecuencia_semanal))), 1) : null,
  }
})
kpiModulos.sort((a, b) => b.adopcion_pct - a.adopcion_pct)

// ── KPI 4 · Eficiencia de tareas ──────────────────────────────────────────────

const kpiTareas = [...agrupar(tareas, 'tarea')].map(([clave, filas]) => {
  const exitosas = filas.filter((f) => f.exito === '1')
  const tiempos = exitosas.map((f) => num(f.segundos))
  return {
    tarea: clave,
    descripcion: filas[0].descripcion,
    tasa_exito_pct: r((exitosas.length / filas.length) * 100, 1),
    tiempo_medio_seg: r(media(tiempos), 1),
    tiempo_mediana_seg: r(mediana(tiempos), 1),
    p90_seg: r(percentil(tiempos, 0.9), 1),
    errores_medios: r(media(filas.map((f) => num(f.errores))), 2),
    pidio_ayuda_pct: r((filas.filter((f) => f.pidio_ayuda === 'Sí').length / filas.length) * 100, 1),
  }
})
kpiTareas.sort((a, b) => a.tarea.localeCompare(b.tarea))

const totalIntentos = tareas.length
const totalExitos = tareas.filter((f) => f.exito === '1').length

// Tiempo hasta el primer valor: crear portafolio + registrar la primera compra.
const ttfvPorUsuario = participantes.map((p) => {
  const t = tareas.filter((f) => f.id === p.id && (f.tarea === 'T1' || f.tarea === 'T2'))
  return suma(t.map((f) => num(f.segundos)))
})

const kpiEficiencia = {
  tasa_exito_global_pct: r((totalExitos / totalIntentos) * 100, 1),
  intentos: totalIntentos,
  exitos: totalExitos,
  errores_por_participante: r(suma(tareas.map((f) => num(f.errores))) / n, 2),
  pct_sin_errores: r((participantes.filter((p) => suma(tareas.filter((f) => f.id === p.id).map((f) => num(f.errores))) === 0).length / n) * 100, 1),
  pidio_ayuda_pct: r((tareas.filter((f) => f.pidio_ayuda === 'Sí').length / totalIntentos) * 100, 1),
  ttfv_medio_seg: r(media(ttfvPorUsuario), 1),
  ttfv_mediana_seg: r(mediana(ttfvPorUsuario), 1),
  ttfv_medio_min: r(media(ttfvPorUsuario) / 60, 2),
  ttfv_p90_seg: r(percentil(ttfvPorUsuario, 0.9), 1),
  por_tarea: kpiTareas,
}

// ── KPI 5 · Engagement en la semana de registro ───────────────────────────────

const porDia = [...agrupar(bitacora, 'dia')]
  .map(([dia, filas]) => {
    const activos = filas.filter((f) => f.registro_completado === 'Sí')
    return {
      dia: Number(dia),
      fecha: filas[0].fecha,
      dia_semana: filas[0].dia_semana,
      mercado: filas[0].mercado,
      usuarios_activos: activos.length,
      dau_pct: r((activos.length / n) * 100, 1),
      sesiones: suma(filas.map((f) => num(f.sesiones))),
      minutos: r(suma(filas.map((f) => num(f.minutos_en_app))), 1),
      minutos_por_activo: activos.length ? r(suma(filas.map((f) => num(f.minutos_en_app))) / activos.length, 1) : 0,
      operaciones: suma(filas.map((f) => num(f.operaciones_registradas))),
      aportaciones_mxn: suma(filas.map((f) => num(f.aportacion_mxn))),
    }
  })
  .sort((a, b) => a.dia - b.dia)

const diasRegistrados = resumen.map((f) => num(f.dias_registrados))
const minutosSemana = resumen.map((f) => num(f.minutos_semana))
const sesionesSemana = resumen.map((f) => num(f.sesiones_semana))
const alertasRec = suma(resumen.map((f) => num(f.alertas_recibidas)))
const alertasAcc = suma(resumen.map((f) => num(f.alertas_accionadas)))

const kpiEngagement = {
  adherencia_registro_pct: r((suma(diasRegistrados) / (n * 7)) * 100, 1),
  dias_registrados_medios: r(media(diasRegistrados), 2),
  usuarios_7_de_7: diasRegistrados.filter((x) => x === 7).length,
  usuarios_5_o_mas: diasRegistrados.filter((x) => x >= 5).length,
  retencion_semana_pct: r((diasRegistrados.filter((x) => x >= 5).length / n) * 100, 1),
  dau_medio: r(media(porDia.map((d) => d.usuarios_activos)), 2),
  dau_wau_stickiness_pct: r((media(porDia.map((d) => d.usuarios_activos)) / n) * 100, 1),
  activos_dia_1: porDia[0].usuarios_activos,
  activos_dia_7: porDia[6].usuarios_activos,
  caida_d1_d7_pct: r(((porDia[6].usuarios_activos - porDia[0].usuarios_activos) / porDia[0].usuarios_activos) * 100, 1),
  sesiones_por_usuario_semana: r(media(sesionesSemana), 2),
  minutos_por_usuario_semana: r(media(minutosSemana), 1),
  minutos_por_sesion: r(suma(minutosSemana) / suma(sesionesSemana), 2),
  operaciones_totales: suma(resumen.map((f) => num(f.operaciones_semana))),
  operaciones_por_usuario: r(media(resumen.map((f) => num(f.operaciones_semana))), 2),
  aportaciones_totales_mxn: suma(resumen.map((f) => num(f.aportaciones_semana_mxn))),
  usuarios_que_aportaron: resumen.filter((f) => num(f.aportaciones_semana_mxn) > 0).length,
  tasa_aportacion_pct: r((resumen.filter((f) => num(f.aportaciones_semana_mxn) > 0).length / n) * 100, 1),
  alertas_recibidas: alertasRec,
  alertas_accionadas: alertasAcc,
  tasa_accion_alertas_pct: alertasRec ? r((alertasAcc / alertasRec) * 100, 1) : 0,
  actividad_habil_vs_fin_semana: {
    dau_dias_habiles: r(media(porDia.filter((d) => d.mercado === 'Abierto').map((d) => d.usuarios_activos)), 2),
    dau_fin_de_semana: r(media(porDia.filter((d) => d.mercado === 'Cerrado').map((d) => d.usuarios_activos)), 2),
  },
  por_dia: porDia,
}

// ── KPI 6 · Desempeño del portafolio simulado ─────────────────────────────────

const rend = resumen.map((f) => num(f.rendimiento_twr_semana_pct))
const dd = resumen.map((f) => num(f.max_drawdown_semana_pct))
const volAnual = resumen.map((f) => num(f.volatilidad_anualizada_pct))

const kpiPortafolio = {
  capital_inicial_total_mxn: suma(resumen.map((f) => num(f.capital_inicial_mxn))),
  capital_inicial_medio_mxn: r(media(resumen.map((f) => num(f.capital_inicial_mxn))), 0),
  aportaciones_total_mxn: suma(resumen.map((f) => num(f.aportaciones_semana_mxn))),
  valor_final_total_mxn: suma(resumen.map((f) => num(f.valor_final_mxn))),
  pnl_total_mxn: suma(resumen.map((f) => num(f.pnl_semana_mxn))),
  rendimiento_twr_medio_pct: r(media(rend), 3),
  rendimiento_twr_mediana_pct: r(mediana(rend), 3),
  rendimiento_ic95: ic95(rend),
  mejor_pct: r(Math.max(...rend), 3),
  peor_pct: r(Math.min(...rend), 3),
  pct_en_positivo: r((rend.filter((x) => x > 0).length / n) * 100, 1),
  volatilidad_anualizada_media_pct: r(media(volAnual), 2),
  max_drawdown_medio_pct: r(media(dd), 3),
  max_drawdown_peor_pct: r(Math.min(...dd), 3),
  por_perfil: [...agrupar(resumen, 'perfil_riesgo')].map(([perfil, filas]) => ({
    perfil,
    n: filas.length,
    rendimiento_medio_pct: r(media(filas.map((f) => num(f.rendimiento_twr_semana_pct))), 3),
    volatilidad_anualizada_pct: r(media(filas.map((f) => num(f.volatilidad_anualizada_pct))), 2),
    max_drawdown_medio_pct: r(media(filas.map((f) => num(f.max_drawdown_semana_pct))), 3),
    sharpe_medio: r(media(filas.map((f) => num(f.sharpe_anualizado_aprox))), 2),
    capital_medio_mxn: r(media(filas.map((f) => num(f.capital_inicial_mxn))), 0),
    operaciones_medias: r(media(filas.map((f) => num(f.operaciones_semana))), 2),
  })),
  mercado_por_dia: porDia.map((d) => {
    const filas = bitacora.filter((f) => Number(f.dia) === d.dia)
    return {
      dia: d.dia,
      fecha: d.fecha,
      dia_semana: d.dia_semana,
      mercado: d.mercado,
      retorno_medio_pct: r(media(filas.map((f) => num(f.retorno_dia_pct))), 3),
      pnl_agregado_mxn: suma(filas.map((f) => num(f.pnl_dia_mxn))),
      pct_usuarios_en_verde: r((filas.filter((f) => num(f.retorno_dia_pct) > 0).length / n) * 100, 1),
    }
  }),
}
kpiPortafolio.por_perfil.sort((a, b) => a.perfil.localeCompare(b.perfil))

// ── KPI 7 · Temas de las respuestas abiertas ──────────────────────────────────

const mejoras = comentarios.filter((c) => c.tipo === 'Qué mejorarías')
const kpiTemas = [...agrupar(mejoras, 'tema_codificado')]
  .map(([tema, filas]) => ({
    tema,
    menciones: filas.length,
    pct: r((filas.length / mejoras.length) * 100, 1),
    ids: filas.map((f) => f.id).join(' '),
  }))
  .sort((a, b) => b.menciones - a.menciones || a.tema.localeCompare(b.tema))

// ── Tablero: meta vs resultado ────────────────────────────────────────────────

const semaforo = (ok, casi) => (ok ? '🟢' : casi ? '🟡' : '🔴')
const TABLERO = [
  { kpi: 'SUS (usabilidad)', meta: '≥ 75', valor: kpiSus.media, fmt: (v) => `${v}/100`, estado: semaforo(kpiSus.media >= 75, kpiSus.media >= 68) },
  { kpi: 'NPS', meta: '≥ +30', valor: kpiSatisfaccion.nps, fmt: (v) => `${v > 0 ? '+' : ''}${v}`, estado: semaforo(kpiSatisfaccion.nps >= 30, kpiSatisfaccion.nps >= 0) },
  { kpi: 'CSAT top-2 (4-5)', meta: '≥ 80%', valor: kpiSatisfaccion.csat_top2_pct, fmt: (v) => `${v}%`, estado: semaforo(kpiSatisfaccion.csat_top2_pct >= 80, kpiSatisfaccion.csat_top2_pct >= 70) },
  { kpi: 'CES (facilidad 1-7)', meta: '≥ 5.5', valor: kpiSatisfaccion.ces_media, fmt: (v) => `${v}/7`, estado: semaforo(kpiSatisfaccion.ces_media >= 5.5, kpiSatisfaccion.ces_media >= 5) },
  { kpi: 'Tasa de éxito en tareas', meta: '≥ 90%', valor: kpiEficiencia.tasa_exito_global_pct, fmt: (v) => `${v}%`, estado: semaforo(kpiEficiencia.tasa_exito_global_pct >= 90, kpiEficiencia.tasa_exito_global_pct >= 85) },
  { kpi: 'Tiempo al primer valor (TTFV)', meta: '≤ 5 min', valor: kpiEficiencia.ttfv_medio_min, fmt: (v) => `${v} min`, estado: semaforo(kpiEficiencia.ttfv_medio_min <= 5, kpiEficiencia.ttfv_medio_min <= 6) },
  { kpi: 'Adherencia al registro semanal', meta: '≥ 70%', valor: kpiEngagement.adherencia_registro_pct, fmt: (v) => `${v}%`, estado: semaforo(kpiEngagement.adherencia_registro_pct >= 70, kpiEngagement.adherencia_registro_pct >= 60) },
  { kpi: 'Retención semanal (≥5 de 7 días)', meta: '≥ 75%', valor: kpiEngagement.retencion_semana_pct, fmt: (v) => `${v}%`, estado: semaforo(kpiEngagement.retencion_semana_pct >= 75, kpiEngagement.retencion_semana_pct >= 65) },
  { kpi: 'Intención de continuar (top-2)', meta: '≥ 75%', valor: kpiSatisfaccion.intencion_top2_pct, fmt: (v) => `${v}%`, estado: semaforo(kpiSatisfaccion.intencion_top2_pct >= 75, kpiSatisfaccion.intencion_top2_pct >= 65) },
  { kpi: 'Acción sobre alertas', meta: '≥ 50%', valor: kpiEngagement.tasa_accion_alertas_pct, fmt: (v) => `${v}%`, estado: semaforo(kpiEngagement.tasa_accion_alertas_pct >= 50, kpiEngagement.tasa_accion_alertas_pct >= 40) },
  { kpi: 'Confianza en las cifras', meta: '≥ 4.0/5', valor: kpiSatisfaccion.confianza_cifras_media, fmt: (v) => `${v}/5`, estado: semaforo(kpiSatisfaccion.confianza_cifras_media >= 4, kpiSatisfaccion.confianza_cifras_media >= 3.6) },
  { kpi: 'Disposición a pagar', meta: '≥ 50%', valor: kpiSatisfaccion.disposicion_pago.pct_dispuesto, fmt: (v) => `${v}%`, estado: semaforo(kpiSatisfaccion.disposicion_pago.pct_dispuesto >= 50, kpiSatisfaccion.disposicion_pago.pct_dispuesto >= 40) },
]

// ── Salida ────────────────────────────────────────────────────────────────────

const kpis = {
  meta: {
    origen: 'DATOS SIMULADOS (sintéticos) — no provienen de personas reales',
    generado: new Date().toISOString().slice(0, 10),
    participantes: n,
    semana_observada: `${bitacora[0].fecha} a ${bitacora[bitacora.length - 1].fecha}`,
    observaciones_bitacora: bitacora.length,
  },
  tablero: TABLERO.map((t) => ({ kpi: t.kpi, meta: t.meta, resultado: t.fmt(t.valor), estado: t.estado })),
  usabilidad_sus: kpiSus,
  satisfaccion: kpiSatisfaccion,
  adopcion_modulos: kpiModulos,
  eficiencia: kpiEficiencia,
  engagement: kpiEngagement,
  portafolio_simulado: kpiPortafolio,
  temas_de_mejora: kpiTemas,
}

writeFileSync(join(DATA, 'kpis.json'), JSON.stringify(kpis, null, 2) + '\n', 'utf8')

// Tablas Markdown auto-generadas (se incrustan en el informe)
const md = []
md.push('<!-- Generado por scripts/encuestas/calcular-kpis.mjs — no editar a mano -->')
md.push('')
md.push('## Tablero de KPIs')
md.push('')
md.push('| KPI | Meta | Resultado | Estado |')
md.push('| --- | --- | --- | :---: |')
for (const t of TABLERO) md.push(`| ${t.kpi} | ${t.meta} | **${t.fmt(t.valor)}** | ${t.estado} |`)
md.push('')
md.push('## Adopción y utilidad por módulo')
md.push('')
md.push('| Módulo | Adopción | Usuarios | Utilidad media | % 4-5 | Usos/semana |')
md.push('| --- | ---: | ---: | ---: | ---: | ---: |')
for (const m of kpiModulos) md.push(`| ${m.modulo} | ${m.adopcion_pct}% | ${m.usuarios}/${n} | ${m.utilidad_media ?? '—'} | ${m.utilidad_top2_pct ?? '—'}% | ${m.frecuencia_semanal_media ?? '—'} |`)
md.push('')
md.push('## Eficiencia por tarea')
md.push('')
md.push('| Tarea | Éxito | Tiempo medio | Mediana | P90 | Errores | Pidió ayuda |')
md.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: |')
for (const t of kpiTareas) md.push(`| ${t.tarea} · ${t.descripcion} | ${t.tasa_exito_pct}% | ${t.tiempo_medio_seg}s | ${t.tiempo_mediana_seg}s | ${t.p90_seg}s | ${t.errores_medios} | ${t.pidio_ayuda_pct}% |`)
md.push('')
md.push('## Actividad diaria (semana de registro)')
md.push('')
md.push('| Día | Fecha | Mercado | Activos | DAU | Sesiones | Minutos | Operaciones | Aportaciones | Retorno medio |')
md.push('| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |')
porDia.forEach((d, i) => {
  const m = kpiPortafolio.mercado_por_dia[i]
  md.push(
    `| ${d.dia_semana} | ${d.fecha} | ${d.mercado} | ${d.usuarios_activos}/${n} | ${d.dau_pct}% | ${d.sesiones} | ${d.minutos} | ${d.operaciones} | $${d.aportaciones_mxn.toLocaleString('es-MX')} | ${m.retorno_medio_pct}% |`,
  )
})
md.push('')
md.push('## Desempeño del portafolio simulado por perfil')
md.push('')
md.push('| Perfil | n | Capital medio | Rend. semana (TWR) | Vol. anualizada | Máx. drawdown | Sharpe aprox. | Operaciones |')
md.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |')
for (const p of kpiPortafolio.por_perfil)
  md.push(`| ${p.perfil} | ${p.n} | $${p.capital_medio_mxn.toLocaleString('es-MX')} | ${p.rendimiento_medio_pct}% | ${p.volatilidad_anualizada_pct}% | ${p.max_drawdown_medio_pct}% | ${p.sharpe_medio} | ${p.operaciones_medias} |`)
md.push('')
md.push('## Temas de mejora (respuestas abiertas)')
md.push('')
md.push('| Tema | Menciones | % | Participantes |')
md.push('| --- | ---: | ---: | --- |')
for (const t of kpiTemas) md.push(`| ${t.tema} | ${t.menciones} | ${t.pct}% | ${t.ids} |`)
md.push('')

writeFileSync(join(DATA, 'tablas-kpi.md'), md.join('\n'), 'utf8')

// Resumen en consola
console.log(`\n📊 KPIs sobre ${n} encuestas simuladas · semana ${kpis.meta.semana_observada}\n`)
for (const t of TABLERO) console.log(`  ${t.estado}  ${t.kpi.padEnd(32)} ${String(t.fmt(t.valor)).padStart(9)}   (meta ${t.meta})`)
console.log('\n✓ data/kpis.json')
console.log('✓ data/tablas-kpi.md')
