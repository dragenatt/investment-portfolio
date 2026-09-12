'use client'

import { useState, useCallback } from 'react'
import { allocateMoney } from '@/lib/utils/money'
import {
  PieChart,
  Pie,
  Cell,
  Legend,
  Tooltip,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
} from 'recharts'
import {
  obtenerPerfilFinal,
  obtenerRecomendacion,
  PERFIL_DESCRIPCIONES,
  CARTERAS,
  RENDIMIENTOS,
  VOLATILIDADES,
  type PerfilNivel,
  type PerfilNombre,
} from '@/lib/utils/investment-profile'
import {
  buildScenarios,
  evaluarPlan,
  aporteParaProbabilidadMeta,
  analizarSensibilidad,
  validarEntradasAdvisor,
  type PlanOutcome,
  type CampoProblema,
} from '@/lib/services/advisor'
import {
  explicarRecomendacion,
  viabilidadAportacion,
  invertirVsAhorrar,
  type Explicacion,
  type Viabilidad,
  type ComparacionAhorro,
} from '@/lib/services/advisor-explain'
import {
  explicacionEducativa,
  type Educacion,
} from '@/lib/services/advisor-education'
import { ModoEducativo } from '@/components/advisor/advisor-education'
import {
  construirPlanExportable,
  type PlanExport,
} from '@/lib/services/advisor-export'
import { ExportarPlan } from '@/components/advisor/advisor-export'
import {
  PorQueEstaRecomendacion,
  ViabilidadCard,
  InvertirVsAhorrarCard,
} from '@/components/advisor/advisor-explain'
import {
  Shield,
  Scale,
  Flame,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  RotateCcw,
  Target,
  TrendingUp,
  DollarSign,
  Percent,
} from 'lucide-react'
import { useTranslation } from '@/lib/i18n'
import type { Dictionary } from '@/lib/i18n/types'

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

const DONUT_COLORS = ['#6366F1', '#22C55E', '#F59E0B', '#EF4444', '#8B5CF6', '#06B6D4']

const PROFILE_COLORS: Record<PerfilNombre, { bg: string; text: string; border: string; badge: string }> = {
  Conservador: {
    bg: 'bg-blue-500/10',
    text: 'text-blue-600 dark:text-blue-400',
    border: 'border-blue-500/30',
    badge: 'bg-blue-500/20 text-blue-700 dark:text-blue-300',
  },
  Moderado: {
    bg: 'bg-amber-500/10',
    text: 'text-amber-600 dark:text-amber-400',
    border: 'border-amber-500/30',
    badge: 'bg-amber-500/20 text-amber-700 dark:text-amber-300',
  },
  Agresivo: {
    bg: 'bg-red-500/10',
    text: 'text-red-600 dark:text-red-400',
    border: 'border-red-500/30',
    badge: 'bg-indigo-500/20 text-indigo-700 dark:text-indigo-300',
  },
}

const PROFILE_ICONS: Record<PerfilNombre, typeof Shield> = {
  Conservador: Shield,
  Moderado: Scale,
  Agresivo: Flame,
}

const getStepTitles = (t: Dictionary) => [
  t.advisor.personal_data,
  t.advisor.risk_tolerance,
  t.advisor.financial_capacity,
  t.advisor.capital_investment,
]

// ── Pill Button ───────────────────────────────────────────────────────────────

function PillButton({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`btn-press rounded-full px-4 py-2 text-sm font-medium transition-colors ${
        active
          ? 'bg-primary text-primary-foreground'
          : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
      }`}
    >
      {label}
    </button>
  )
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface FormState {
  edad: string
  ingresos: string
  riesgo: number
  experiencia: number
  reaccion: number
  horizonte: string
  estabilidad: number
  porcentajeInversion: number
  capitalInicial: string
  aportacionMensual: string
  meta: string
}

interface ResultsState {
  nivel: PerfilNivel
  nombre: PerfilNombre
  plan: PlanOutcome
  /** Valid but worth questioning — e.g. a contribution that swallows the income. */
  avisos: CampoProblema[]
  prob: number
  /** Contribution that reaches PROBABILIDAD_OBJETIVO on the same scenarios. */
  aporteNec: number | null
  recomendacion: string
  /** Why this came out the way it did, in the user's own numbers. */
  explicacion: Explicacion | null
  /** The contribution measured against what they actually earn. */
  viabilidad: Viabilidad | null
  /** The same money saved rather than invested. */
  ahorroVsInversion: ComparacionAhorro | null
  /** What every word in the projection means. Teaching, kept apart from result. */
  educacion: Educacion | null
  /** The whole plan as a document, ready to serialise. */
  exportable: PlanExport | null
}

type Distribucion = PlanOutcome['distribucion']

/**
 * Deciles rather than the single best and worst paths. The extremes of a
 * simulation are the least stable statistics it produces — the "worst case"
 * moves every run and says more about the number of draws than about risk.
 */
const PERCENTIL_BANDS: Array<{
  label: string
  hint: string
  className: string
  pick: (d: Distribucion) => number
}> = [
  {
    label: 'P10',
    hint: '1 de cada 10 escenarios termina por debajo de esta cifra',
    className: 'bg-red-500/10 border-red-500/20',
    pick: (d) => d.p10,
  },
  {
    label: 'P25',
    hint: '1 de cada 4 escenarios termina por debajo',
    className: 'bg-amber-500/10 border-amber-500/20',
    pick: (d) => d.p25,
  },
  {
    label: 'Mediana',
    hint: 'la mitad de los escenarios termina por encima y la mitad por debajo',
    className: 'bg-sky-500/10 border-sky-500/20',
    pick: (d) => d.p50,
  },
  {
    label: 'P75',
    hint: '1 de cada 4 escenarios termina por encima',
    className: 'bg-emerald-500/10 border-emerald-500/20',
    pick: (d) => d.p75,
  },
  {
    label: 'P90',
    hint: '1 de cada 10 escenarios termina por encima',
    className: 'bg-green-500/10 border-green-500/20',
    pick: (d) => d.p90,
  },
]

/** The confidence the recommended contribution is solved for. */
const PROBABILIDAD_OBJETIVO = 75

/** Scenarios per run: enough for stable deciles without stalling the browser. */
const SIMULACIONES = 1000

/**
 * A seed derived from the plan itself, so re-running the same questionnaire
 * gives the same answer while two different plans still get different draws.
 */
function seedFor(...parts: number[]): number {
  let hash = 2166136261
  for (const part of parts) {
    hash ^= Math.round(part * 100)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function AdvisorPage() {
  const { t } = useTranslation()
  const STEP_TITLES = getStepTitles(t)
  const [step, setStep] = useState(0)
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<ResultsState | null>(null)

  const [form, setForm] = useState<FormState>({
    edad: '',
    ingresos: '',
    riesgo: 5,
    experiencia: 0,
    reaccion: 0,
    horizonte: '',
    estabilidad: 0,
    porcentajeInversion: 20,
    capitalInicial: '',
    aportacionMensual: '',
    meta: '',
  })

  const updateField = useCallback(
    <K extends keyof FormState>(key: K, value: FormState[K]) => {
      setForm((prev) => ({ ...prev, [key]: value }))
    },
    [],
  )

  const canAdvance = useCallback((): boolean => {
    switch (step) {
      case 0:
        return Number(form.edad) > 0 && Number(form.ingresos) > 0
      case 1:
        return form.experiencia > 0 && form.reaccion > 0
      case 2:
        return Number(form.horizonte) >= 1 && form.estabilidad > 0
      case 3: {
        // The whole questionnaire is known by now, so validate it as a whole
        // rather than re-checking three fields by hand.
        if (form.capitalInicial === '' || form.aportacionMensual === '') return false
        return validarEntradasAdvisor({
          edad: Number(form.edad),
          ingresos: Number(form.ingresos),
          horizonte: Number(form.horizonte),
          capitalInicial: Number(form.capitalInicial),
          aportacionMensual: Number(form.aportacionMensual),
          meta: Number(form.meta),
          porcentajeInversion: form.porcentajeInversion,
          riesgo: form.riesgo,
          experiencia: form.experiencia,
          estabilidad: form.estabilidad,
          reaccion: form.reaccion,
        }).valid
      }
      default:
        return false
    }
  }, [step, form])

  const handleSubmit = useCallback(() => {
    setLoading(true)
    setTimeout(() => {
      const edad = Number(form.edad)
      const ingresos = Number(form.ingresos)
      const horizonte = Number(form.horizonte)
      const capitalInicial = Number(form.capitalInicial)
      const aportacionMensual = Number(form.aportacionMensual)
      const meta = Number(form.meta)

      const validacion = validarEntradasAdvisor({
        edad,
        ingresos,
        horizonte,
        capitalInicial,
        aportacionMensual,
        meta,
        porcentajeInversion: form.porcentajeInversion,
        riesgo: form.riesgo,
        experiencia: form.experiencia,
        estabilidad: form.estabilidad,
        reaccion: form.reaccion,
      })
      if (!validacion.valid) {
        // The step gate should have caught this; refuse rather than simulate
        // against numbers the model cannot use.
        setLoading(false)
        return
      }

      const perfil = obtenerPerfilFinal({
        edad,
        ingresos,
        riesgo: form.riesgo,
        horizonte,
        experiencia: form.experiencia,
        estabilidad: form.estabilidad,
        reaccion: form.reaccion,
        porcentajeInversion: form.porcentajeInversion,
      })

      const planParams = {
        capitalInicial,
        aportacionMensual,
        años: horizonte,
        rendimientoAnual: RENDIMIENTOS[perfil.nivel],
        volatilidadAnual: VOLATILIDADES[perfil.nivel],
      }

      // One scenario set answers every question about this plan, so the
      // recommended contribution is scored against the same simulated paths it
      // was solved on. That is what stops the advisor recommending an amount
      // and then calling that same amount insufficient.
      const scenarios = buildScenarios({
        months: horizonte * 12,
        simulations: SIMULACIONES,
        seed: seedFor(capitalInicial, aportacionMensual, horizonte, meta, perfil.nivel),
      })

      const plan = evaluarPlan(planParams, meta, scenarios)
      const prob = plan.probabilidadMetaPct ?? 0
      const aporteNec = aporteParaProbabilidadMeta(
        planParams,
        meta,
        PROBABILIDAD_OBJETIVO,
        scenarios,
      )
      const recomendacion = obtenerRecomendacion(prob, aportacionMensual, aporteNec)

      // The three questions a projection raises the moment it appears. All
      // three read the SAME plan and the same scenario set, so nothing here can
      // disagree with the chart above it.
      //
      // The contribution judged for affordability is the one actually being
      // recommended — the amount needed to reach the target probability when
      // there is one, not the amount the user happened to type.
      const aportacionAJuzgar = aporteNec ?? aportacionMensual

      setResults({
        nivel: perfil.nivel,
        nombre: perfil.nombre,
        plan,
        avisos: validacion.warnings,
        prob,
        aporteNec,
        recomendacion,
        explicacion: explicarRecomendacion(planParams, plan, meta),
        viabilidad: viabilidadAportacion(aportacionAJuzgar, ingresos > 0 ? ingresos : null),
        ahorroVsInversion: invertirVsAhorrar(planParams, plan),
        // The model portfolio behind the profile is what the diversification
        // concept describes. No risk-free rate is passed because this projector
        // does not use one, and the module says so rather than inventing it.
        educacion: explicacionEducativa(planParams, plan, meta, {
          cartera: CARTERAS[perfil.nivel],
        }),
        // Built here rather than on click, from the same plan and the same
        // scenario set as everything above, so an exported file cannot disagree
        // with the screen it came from. analizarSensibilidad has been in
        // advisor.ts and under test since an earlier wave without ever reaching
        // a surface; the export is the first thing that needs it.
        exportable: construirPlanExportable({
          perfil: { nivel: perfil.nivel, nombre: perfil.nombre, descripcion: PERFIL_DESCRIPCIONES[perfil.nombre] },
          params: planParams,
          meta: meta > 0 ? meta : null,
          outcome: plan,
          cartera: CARTERAS[perfil.nivel],
          aporteNecesario: aporteNec,
          // Warnings carry a prefix rather than being folded in silently: they
          // are caveats the screen showed, and a document that drops them reads
          // more confident than the screen it came from.
          recomendaciones: [
            recomendacion,
            ...validacion.warnings.map((aviso) => `Aviso: ${aviso.message}`),
          ],
          probabilidadObjetivoPct: PROBABILIDAD_OBJETIVO,
          sensibilidad: meta > 0 ? analizarSensibilidad(planParams, meta, scenarios) : null,
          generadoEn: new Date(),
        }),
      })
      setLoading(false)
    }, 1500)
  }, [form])

  const handleReset = useCallback(() => {
    setResults(null)
    setStep(0)
    setForm({
      edad: '',
      ingresos: '',
      riesgo: 5,
      experiencia: 0,
      reaccion: 0,
      horizonte: '',
      estabilidad: 0,
      porcentajeInversion: 20,
      capitalInicial: '',
      aportacionMensual: '',
      meta: '',
    })
  }, [])

  // ── Loading State ─────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <div className="w-12 h-12 rounded-full border-4 border-primary border-t-transparent animate-spin" />
        <p className="font-serif text-xl text-muted-foreground">{t.advisor.analyzing_profile}</p>
      </div>
    )
  }

  // ── Results Dashboard ─────────────────────────────────────────────────────

  if (results) {
    const cartera = CARTERAS[results.nivel]
    const capitalInicial = Number(form.capitalInicial)
    const aportacionMensual = Number(form.aportacionMensual)
    const meta = Number(form.meta)
    const colors = PROFILE_COLORS[results.nombre]
    const ProfileIcon = PROFILE_ICONS[results.nombre]

    // Allocate to the cent so the rows add up to the capital and the monthly
    // contribution exactly, instead of each row rounding on its own.
    const carteraEntries = Object.entries(cartera)
    const pesos = carteraEntries.map(([, pct]) => pct)
    const montoInicial = allocateMoney(capitalInicial, pesos)
    const montoMensual = allocateMoney(aportacionMensual, pesos)

    const donutData = carteraEntries.map(([name, value]) => ({
      name,
      value: Math.round(value * 100),
    }))

    const chartData = results.plan.proyeccionDeterminista.historial.map((val, i) => ({
      name: `${t.advisor.years} ${i + 1}`,
      valor: Math.round(val),
    }))

    const probColor =
      results.prob >= 75
        ? 'bg-green-500'
        : results.prob >= 50
          ? 'bg-amber-500'
          : 'bg-red-500'

    const probTextColor =
      results.prob >= 75
        ? 'text-green-600 dark:text-green-400'
        : results.prob >= 50
          ? 'text-amber-600 dark:text-amber-400'
          : 'text-red-600 dark:text-red-400'

    return (
      <div className="space-y-6 stagger-enter">
        {/* A. Profile Card */}
        <div className={`premium-card p-6 ${colors.bg} ${colors.border}`}>
          <div className="flex items-start gap-4">
            <div className={`p-3 rounded-xl ${colors.badge}`}>
              <ProfileIcon className="h-7 w-7" />
            </div>
            <div className="flex-1">
              <h2
                className="font-serif font-bold"
                style={{ fontSize: 'clamp(20px, 2.5vw, 32px)' }}
              >
                Perfil: {results.nombre}
              </h2>
              <p className="text-muted-foreground mt-1">
                {PERFIL_DESCRIPCIONES[results.nombre]}
              </p>
              <span
                className={`inline-block mt-3 rounded-full px-3 py-1 text-xs font-semibold ${colors.badge}`}
              >
                Rendimiento esperado: {(RENDIMIENTOS[results.nivel] * 100).toFixed(0)}% anual
              </span>
            </div>
          </div>
        </div>

        {/* B & C Row */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* B. Portfolio Allocation */}
          <div className="premium-card p-6">
            <h3
              className="font-serif font-bold mb-4"
              style={{ fontSize: 'clamp(20px, 2.5vw, 32px)' }}
            >
              Portafolio Sugerido
            </h3>
            <div className="flex justify-center">
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie
                    data={donutData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={90}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {donutData.map((_, idx) => (
                      <Cell key={idx} fill={DONUT_COLORS[idx % DONUT_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value) => `${value}%`}
                    contentStyle={{
                      borderRadius: '12px',
                      border: '1px solid var(--border)',
                      background: 'var(--card)',
                    }}
                  />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <table className="w-full mt-4 text-sm">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left py-2">Activo</th>
                  <th className="text-right py-2">%</th>
                  <th className="text-right py-2">Monto</th>
                </tr>
              </thead>
              <tbody>
                {carteraEntries.map(([asset, pct], i) => (
                  <tr key={asset} className="border-b border-border/50">
                    <td className="py-2">{asset}</td>
                    <td className="text-right font-mono">{(pct * 100).toFixed(0)}%</td>
                    <td className="text-right font-mono">{fmt.format(montoInicial[i])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* C. Monthly Distribution */}
          <div className="premium-card p-6">
            <h3
              className="font-serif font-bold mb-4"
              style={{ fontSize: 'clamp(20px, 2.5vw, 32px)' }}
            >
              Distribución de tu Aportación Mensual
            </h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left py-2">Activo</th>
                  <th className="text-right py-2">%</th>
                  <th className="text-right py-2">Mensual</th>
                </tr>
              </thead>
              <tbody>
                {carteraEntries.map(([asset, pct], i) => (
                  <tr key={asset} className="border-b border-border/50">
                    <td className="py-2">{asset}</td>
                    <td className="text-right font-mono">{(pct * 100).toFixed(0)}%</td>
                    <td className="text-right font-mono">
                      {fmt.format(montoMensual[i])}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-4 pt-4 border-t border-border flex justify-between font-semibold">
              <span>Total mensual</span>
              <span className="font-mono">{fmt.format(aportacionMensual)}</span>
            </div>
          </div>
        </div>

        {/* D. Investment Growth Chart */}
        <div className="premium-card p-6">
          <h3
            className="font-serif font-bold mb-4"
            style={{ fontSize: 'clamp(20px, 2.5vw, 32px)' }}
          >
            Proyección de Crecimiento
          </h3>
          <ResponsiveContainer width="100%" height={320}>
            <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
              <defs>
                <linearGradient id="growthGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#22C55E" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#22C55E" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} stroke="var(--muted-foreground)" />
              <YAxis
                tickFormatter={(v: number) => fmt.format(v)}
                tick={{ fontSize: 11 }}
                stroke="var(--muted-foreground)"
                width={90}
              />
              <Tooltip
                formatter={(value) => fmt.format(Number(value))}
                contentStyle={{
                  borderRadius: '12px',
                  border: '1px solid var(--border)',
                  background: 'var(--card)',
                }}
                labelStyle={{ fontWeight: 600 }}
              />
              <Area
                type="monotone"
                dataKey="valor"
                stroke="#22C55E"
                strokeWidth={2}
                fill="url(#growthGradient)"
                name="Valor del portafolio"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* E. Financial Summary */}
        <div className="premium-card p-6">
          <h3
            className="font-serif font-bold mb-4"
            style={{ fontSize: 'clamp(20px, 2.5vw, 32px)' }}
          >
            Resumen Financiero
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center p-4 rounded-xl bg-secondary">
              <DollarSign className="h-5 w-5 mx-auto mb-2 text-muted-foreground" />
              <p className="text-xs text-muted-foreground mb-1">Capital aportado</p>
              <p className="font-serif font-bold text-lg">
                <span className="font-mono">{fmt.format(results.plan.proyeccionDeterminista.capitalAportado)}</span>
              </p>
            </div>
            <div className="text-center p-4 rounded-xl bg-secondary">
              <TrendingUp className="h-5 w-5 mx-auto mb-2 text-gain" />
              <p className="text-xs text-muted-foreground mb-1">Rendimiento generado</p>
              <p className="font-serif font-bold text-lg text-gain">
                <span className="font-mono">{fmt.format(results.plan.proyeccionDeterminista.ganancia)}</span>
              </p>
            </div>
            <div className="text-center p-4 rounded-xl bg-secondary">
              <BarChart3 className="h-5 w-5 mx-auto mb-2 text-primary" />
              <p className="text-xs text-muted-foreground mb-1">Valor final del portafolio</p>
              <p className="font-serif font-bold text-lg">
                <span className="font-mono">{fmt.format(results.plan.proyeccionDeterminista.valorFinal)}</span>
              </p>
            </div>
            <div className="text-center p-4 rounded-xl bg-secondary">
              <Percent className="h-5 w-5 mx-auto mb-2 text-muted-foreground" />
              <p className="text-xs text-muted-foreground mb-1">Rentabilidad total</p>
              <p className="font-serif font-bold text-lg">
                <span className="font-mono">
                  {results.plan.proyeccionDeterminista.rentabilidadTotalPct.toFixed(1)}%
                </span>
              </p>
            </div>
          </div>
        </div>

        {/* F. Monte Carlo Analysis */}
        <div className="premium-card p-6">
          <h3
            className="font-serif font-bold mb-4"
            style={{ fontSize: 'clamp(20px, 2.5vw, 32px)' }}
          >
            Análisis de Escenarios (Monte Carlo)
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {PERCENTIL_BANDS.map((band) => (
              <div
                key={band.label}
                title={band.hint}
                className={"rounded-xl p-3 text-center border " + band.className}
              >
                <p className="text-xs font-medium text-muted-foreground mb-1">{band.label}</p>
                <p className="font-serif font-bold text-lg">
                  <span className="font-mono">
                    {fmt.format(band.pick(results.plan.distribucion))}
                  </span>
                </p>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            La simulacion proyecta {results.plan.modelo.simulaciones.toLocaleString('es-MX')}{' '}
            escenarios bajo los supuestos actuales:{' '}
            {(results.plan.modelo.rendimientoAnual * 100).toFixed(0)}% de rendimiento esperado y{' '}
            {(results.plan.modelo.volatilidadAnual * 100).toFixed(0)}% de volatilidad anual. Son
            escenarios simulados, no predicciones garantizadas.
          </p>
        </div>

        {/* G. Goal Analysis */}
        <div className="premium-card p-6">
          <h3
            className="font-serif font-bold mb-4"
            style={{ fontSize: 'clamp(20px, 2.5vw, 32px)' }}
          >
            Análisis de Meta Financiera
          </h3>
          <div className="flex items-center gap-4 mb-4">
            <Target className={`h-6 w-6 ${probTextColor}`} />
            <div className="flex-1">
              <div className="flex justify-between text-sm mb-1">
                <span>Meta: {fmt.format(meta)}</span>
                <span className={`font-mono font-semibold ${probTextColor}`}>
                  {results.prob.toFixed(1)}%
                </span>
              </div>
              <div className="h-2 rounded-full bg-secondary overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${probColor}`}
                  style={{ width: `${Math.min(results.prob, 100)}%` }}
                />
              </div>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">{results.recomendacion}</p>
          {results.avisos.map((aviso) => (
            <p
              key={aviso.field}
              className="text-sm mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2"
            >
              {aviso.message}
            </p>
          ))}
          {results.aporteNec !== null && results.aporteNec > 0 && (
            <p className="text-sm mt-2 font-medium">
              Aporte mensual para llegar a {PROBABILIDAD_OBJETIVO}% de probabilidad:{' '}
              <span className="font-mono text-primary">{fmt.format(results.aporteNec)}</span>
            </p>
          )}
          {results.aporteNec === null && (
            <p className="text-sm mt-2 text-muted-foreground">
              Ningun aporte razonable alcanza {PROBABILIDAD_OBJETIVO}% de probabilidad con esta
              meta y este plazo. Amplia el horizonte o ajusta la meta.
            </p>
          )}
        </div>

        {/* Kept visually apart from the projection above: a model result and an
            explanation of a model result are different claims. */}
        <div className="space-y-4">
          <PorQueEstaRecomendacion explicacion={results.explicacion} />
          <ViabilidadCard viabilidad={results.viabilidad} />
          <InvertirVsAhorrarCard comparacion={results.ahorroVsInversion} />
          <ModoEducativo educacion={results.educacion} />
          <ExportarPlan plan={results.exportable} />
        </div>

        {/* H. Reset Button */}
        <div className="flex justify-center">
          <button
            type="button"
            onClick={handleReset}
            className="btn-press flex items-center gap-2 bg-secondary text-secondary-foreground rounded-xl px-6 py-3 font-medium hover:bg-secondary/80 transition-colors"
          >
            <RotateCcw className="h-4 w-4" />
            {t.advisor.restart}
          </button>
        </div>
      </div>
    )
  }

  // ── Questionnaire Form ──────────────────────────────────────────────────────

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1
          className="font-serif font-bold"
          style={{ fontSize: 'clamp(20px, 2.5vw, 32px)' }}
        >
          {t.advisor.title}
        </h1>
        <p className="text-muted-foreground mt-1">
          {t.advisor.description}
        </p>
      </div>

      {/* Progress Bar */}
      <div>
        <div className="flex justify-between text-xs text-muted-foreground mb-2">
          <span>
            {t.advisor.step} {step + 1} {t.advisor.of} 4 — {STEP_TITLES[step]}
          </span>
          <span>{Math.round(((step + 1) / 4) * 100)}%</span>
        </div>
        <div className="h-2 rounded-full bg-secondary overflow-hidden">
          <div
            className="h-full rounded-full bg-primary transition-all duration-300"
            style={{ width: `${((step + 1) / 4) * 100}%` }}
          />
        </div>
      </div>

      {/* Step Card */}
      <div className="premium-card p-6 space-y-5">
        {/* Step 1/4 */}
        {step === 0 && (
          <>
            <div>
              <label className="block text-sm font-medium mb-1.5">Edad</label>
              <input
                type="number"
                placeholder="25"
                value={form.edad}
                onChange={(e) => updateField('edad', e.target.value)}
                className="w-full rounded-xl border border-border bg-secondary px-4 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">Ingresos mensuales</label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-mono">
                  $
                </span>
                <input
                  type="number"
                  placeholder="30,000"
                  value={form.ingresos}
                  onChange={(e) => updateField('ingresos', e.target.value)}
                  className="w-full rounded-xl border border-border bg-secondary pl-8 pr-4 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
            </div>
          </>
        )}

        {/* Step 2/4 */}
        {step === 1 && (
          <>
            <div>
              <label className="block text-sm font-medium mb-2">
                ¿Cuál es tu tolerancia al riesgo?
              </label>
              <input
                type="range"
                min={1}
                max={10}
                value={form.riesgo}
                onChange={(e) => updateField('riesgo', Number(e.target.value))}
                className="w-full accent-primary"
              />
              <div className="flex justify-between text-xs text-muted-foreground mt-1">
                <span>1 — Muy bajo</span>
                <span>5 — Medio</span>
                <span>10 — Muy alto</span>
              </div>
              <p className="text-center text-sm font-mono font-semibold mt-1">{form.riesgo}</p>
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">
                ¿Qué experiencia tienes invirtiendo?
              </label>
              <div className="flex flex-wrap gap-2">
                {(['Ninguna', 'Poca', 'Media', 'Alta'] as const).map((label, i) => (
                  <PillButton
                    key={label}
                    label={label}
                    active={form.experiencia === i + 1}
                    onClick={() => updateField('experiencia', i + 1)}
                  />
                ))}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">
                Si tu inversión pierde 20%, ¿qué harías?
              </label>
              <div className="flex flex-wrap gap-2">
                {(['Vender todo', 'Vender algo', 'Mantener', 'Comprar más'] as const).map(
                  (label, i) => (
                    <PillButton
                      key={label}
                      label={label}
                      active={form.reaccion === i + 1}
                      onClick={() => updateField('reaccion', i + 1)}
                    />
                  ),
                )}
              </div>
            </div>
          </>
        )}

        {/* Step 3/4 */}
        {step === 2 && (
          <>
            <div>
              <label className="block text-sm font-medium mb-1.5">Horizonte de inversión</label>
              <div className="relative">
                <input
                  type="number"
                  placeholder="5"
                  value={form.horizonte}
                  onChange={(e) => updateField('horizonte', e.target.value)}
                  className="w-full rounded-xl border border-border bg-secondary px-4 py-2.5 pr-16 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary"
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                  años
                </span>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Estabilidad de ingresos</label>
              <div className="flex flex-wrap gap-2">
                {(
                  ['Muy inestable', 'Algo inestable', 'Estable', 'Muy estable'] as const
                ).map((label, i) => (
                  <PillButton
                    key={label}
                    label={label}
                    active={form.estabilidad === i + 1}
                    onClick={() => updateField('estabilidad', i + 1)}
                  />
                ))}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">
                ¿Qué % de tus ingresos puedes invertir?
              </label>
              <input
                type="range"
                min={0}
                max={100}
                value={form.porcentajeInversion}
                onChange={(e) => updateField('porcentajeInversion', Number(e.target.value))}
                className="w-full accent-primary"
              />
              <p className="text-center text-sm font-mono font-semibold mt-1">
                {form.porcentajeInversion}%
              </p>
            </div>
          </>
        )}

        {/* Step 4/4 */}
        {step === 3 && (
          <>
            <div>
              <label className="block text-sm font-medium mb-1.5">
                Capital inicial a invertir
              </label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-mono">
                  $
                </span>
                <input
                  type="number"
                  placeholder="100,000"
                  value={form.capitalInicial}
                  onChange={(e) => updateField('capitalInicial', e.target.value)}
                  className="w-full rounded-xl border border-border bg-secondary pl-8 pr-4 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">Aportación mensual</label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-mono">
                  $
                </span>
                <input
                  type="number"
                  placeholder="5,000"
                  value={form.aportacionMensual}
                  onChange={(e) => updateField('aportacionMensual', e.target.value)}
                  className="w-full rounded-xl border border-border bg-secondary pl-8 pr-4 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">Meta financiera</label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-mono">
                  $
                </span>
                <input
                  type="number"
                  placeholder="1,000,000"
                  value={form.meta}
                  onChange={(e) => updateField('meta', e.target.value)}
                  className="w-full rounded-xl border border-border bg-secondary pl-8 pr-4 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
            </div>
          </>
        )}
      </div>

      {/* Navigation Buttons */}
      <div className="flex justify-between">
        <button
          type="button"
          onClick={() => setStep((s) => s - 1)}
          disabled={step === 0}
          className="btn-press flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-medium transition-colors bg-secondary text-secondary-foreground hover:bg-secondary/80 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <ArrowLeft className="h-4 w-4" />
          Anterior
        </button>

        {step < 3 ? (
          <button
            type="button"
            onClick={() => setStep((s) => s + 1)}
            disabled={!canAdvance()}
            className="btn-press flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-medium transition-colors bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Siguiente
            <ArrowRight className="h-4 w-4" />
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canAdvance()}
            className="btn-press flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-medium transition-colors bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <BarChart3 className="h-4 w-4" />
            {t.advisor.analyze_profile}
          </button>
        )}
      </div>
    </div>
  )
}
