import { describe, it, expect } from 'vitest'
import {
  construirPlanExportable,
  planAMarkdown,
  planAJSON,
  nombreArchivoPlan,
  CAMPOS_REQUERIDOS,
  type PlanExportInput,
} from '@/lib/services/advisor-export'
import {
  buildScenarios,
  evaluarPlan,
  analizarSensibilidad,
  type PlanParams,
} from '@/lib/services/advisor'

const params: PlanParams = {
  capitalInicial: 50_000,
  aportacionMensual: 5_000,
  años: 20,
  rendimientoAnual: 0.07,
  volatilidadAnual: 0.1,
}

const scenarios = buildScenarios({ months: 240, simulations: 1_000, seed: 12345 })
const outcome = evaluarPlan(params, 3_000_000, scenarios)!
const sensibilidad = analizarSensibilidad(params, 3_000_000, scenarios)

const cartera = { CETES: 0.2, Bonos: 0.2, 'ETF S&P500': 0.35, 'ETF Nasdaq': 0.15, FIBRAS: 0.1 }

const input: PlanExportInput = {
  perfil: { nivel: 1, nombre: 'Moderado', descripcion: 'Buscas equilibrio.' },
  params,
  meta: 3_000_000,
  outcome,
  cartera,
  aporteNecesario: 6_200,
  recomendaciones: ['Manten la aportacion durante todo el horizonte.'],
  probabilidadObjetivoPct: 75,
  sensibilidad,
  // Injected, so an export is reproducible and the test is not a clock race.
  generadoEn: new Date('2026-09-11T18:30:00.000Z'),
}

const plan = construirPlanExportable(input)
const markdown = planAMarkdown(plan)

// ─── the fourteen the roadmap lists ─────────────────────────────────────────

describe('construirPlanExportable', () => {
  it('carries every field the roadmap names', () => {
    for (const campo of CAMPOS_REQUERIDOS) {
      expect(plan).toHaveProperty(campo)
      expect(plan[campo]).not.toBeUndefined()
    }
  })

  it('is deterministic for the same input', () => {
    expect(construirPlanExportable(input)).toEqual(construirPlanExportable(input))
  })

  it('stamps the date it was generated, not the date it is read', () => {
    expect(plan.fecha).toBe('2026-09-11T18:30:00.000Z')
  })

  it('records the model version and seed, so the run can be reproduced', () => {
    expect(plan.modelo.version).toBe(outcome.modelo.version)
    expect(plan.modelo.seed).toBe(12345)
    expect(plan.modelo.simulaciones).toBe(1_000)
  })
})

// ─── the portfolio must add up ──────────────────────────────────────────────

describe('cartera', () => {
  it('has weights summing to exactly 100', () => {
    const total = plan.cartera.reduce((sum, row) => sum + row.pesoPct, 0)
    expect(total).toBeCloseTo(100, 6)
  })

  it('splits the initial capital so the parts add back to it exactly', () => {
    // Rounding each weight's share on its own loses or invents pesos. The
    // existing allocateMoney does the largest-remainder split; this reuses it
    // rather than multiplying and hoping.
    const total = plan.cartera.reduce((sum, row) => sum + row.montoInicial, 0)
    expect(total).toBe(params.capitalInicial)
  })

  it('splits the monthly contribution the same way', () => {
    const total = plan.cartera.reduce((sum, row) => sum + row.aportacionMensual, 0)
    expect(total).toBe(params.aportacionMensual)
  })

  it('names every asset class', () => {
    expect(plan.cartera.map((r) => r.activo).sort()).toEqual(Object.keys(cartera).sort())
  })
})

// ─── scenarios and sensitivity ──────────────────────────────────────────────

describe('escenarios', () => {
  it('reports the five percentiles', () => {
    const etiquetas = plan.escenarios.map((e) => e.etiqueta).join(' ')
    for (const p of ['P10', 'P25', 'P50', 'P75', 'P90']) {
      expect(etiquetas).toContain(p)
    }
  })

  it('says for each one how it compares with what was paid in', () => {
    for (const escenario of plan.escenarios) {
      expect(escenario.vsAportado).toBeCloseTo(
        escenario.valorFinal - plan.capital.aportadoTotal,
        2,
      )
    }
  })

  it('orders them from worst to best', () => {
    const valores = plan.escenarios.map((e) => e.valorFinal)
    for (let i = 1; i < valores.length; i++) {
      expect(valores[i]).toBeGreaterThanOrEqual(valores[i - 1])
    }
  })
})

describe('sensibilidad', () => {
  it('includes every input the analysis varies', () => {
    const variables = plan.sensibilidad!.map((s) => s.variable)
    expect(variables).toContain('aportacion')
    expect(variables).toContain('horizonte')
    expect(variables).toContain('rendimiento')
    expect(variables).toContain('volatilidad')
  })

  it('formats each varied input in its own units', () => {
    // Found by reading the exported document: the tables printed "3200",
    // "0.05" and "6400000" side by side. A reader has to work out which column
    // is money, which is a rate and which is a count.
    const md = planAMarkdown(plan)
    const bloque = (titulo: string) =>
      md.slice(md.indexOf(`### ${titulo}`), md.indexOf(`### ${titulo}`) + 400)

    expect(bloque('Aportacion mensual')).toContain('$4,000')
    expect(bloque('Capital inicial')).toContain('$50,000')
    expect(bloque('Meta')).toContain('$3,000,000')
    expect(bloque('Horizonte (años)')).toMatch(/20 años/)
    expect(bloque('Rendimiento anual supuesto')).toContain('7%')
    expect(bloque('Volatilidad anual supuesta')).toContain('10%')
  })

  it('does not print a bare decimal rate anywhere in the tables', () => {
    const md = planAMarkdown(plan)
    expect(md).not.toMatch(/\| 0\.0[0-9]+ /)
  })

  it('marks which row is the plan as it stands', () => {
    for (const bloque of plan.sensibilidad!) {
      expect(bloque.filas.filter((f) => f.esActual)).toHaveLength(1)
    }
  })
})

// ─── the mandatory sections ─────────────────────────────────────────────────

describe('supuestos y limitaciones', () => {
  it('labels the expected return and the volatility as assumptions with a source', () => {
    const conceptos = plan.supuestos.map((s) => s.concepto.toLowerCase()).join(' ')
    expect(conceptos).toMatch(/rendimiento/)
    expect(conceptos).toMatch(/volatilidad/)
    for (const supuesto of plan.supuestos) {
      expect(supuesto.fuente.length).toBeGreaterThan(0)
    }
  })

  it('names the three things the model does not include at all', () => {
    // Inflation, costs and taxes. Omitting them is what makes a nominal gross
    // projection read better than the money it describes.
    const texto = plan.limitaciones.join(' ').toLowerCase()
    expect(texto).toMatch(/inflaci/)
    expect(texto).toMatch(/comision|costo/)
    expect(texto).toMatch(/impuesto|fiscal/)
  })

  it('says the projection is not a guarantee', () => {
    // The negation has to sit next to the word, not merely somewhere in the
    // paragraph: "garantia" with the "no" three sentences away is not a
    // disclaimer.
    expect(plan.advertencia.toLowerCase()).toMatch(/no .{0,20}garant/)
    expect(plan.advertencia.toLowerCase()).toMatch(/(no|ninguna) .{0,30}asesoria/)
  })
})

// ─── markdown ───────────────────────────────────────────────────────────────

describe('planAMarkdown', () => {
  it('carries the heading the roadmap requires verbatim', () => {
    expect(markdown).toContain('## Supuestos y limitaciones del modelo')
  })

  it('states plainly that it is not a guarantee of results', () => {
    expect(markdown.toLowerCase()).toMatch(/no .{0,40}garant/)
  })

  it('has a section for every field the roadmap names', () => {
    const headings = markdown.match(/^## .+$/gm)!.join(' ').toLowerCase()
    for (const palabra of [
      'perfil',
      'objetivo',
      'horizonte',
      'capital',
      'aportaci',
      'cartera',
      'rendimiento',
      'volatilidad',
      'probabilidad',
      'escenario',
      'sensibilidad',
      'recomendaci',
      'supuesto',
    ]) {
      expect(headings).toContain(palabra)
    }
  })

  it('prints money with its symbol', () => {
    expect(markdown).toContain('$')
  })

  it('never prints an invalid number', () => {
    expect(markdown).not.toMatch(/NaN|Infinity|undefined/)
  })

  it('puts the generation date in the document', () => {
    expect(markdown).toContain('2026-09-11')
  })

  it('renders the portfolio as a table that adds up', () => {
    const filas = markdown.split('\n').filter((l) => l.startsWith('| CETES'))
    expect(filas).toHaveLength(1)
  })
})

// ─── json ───────────────────────────────────────────────────────────────────

describe('planAJSON', () => {
  it('round-trips without losing a field', () => {
    expect(JSON.parse(planAJSON(plan))).toEqual(JSON.parse(JSON.stringify(plan)))
  })

  it('is valid JSON even with no goal set', () => {
    const sinMeta = construirPlanExportable({
      ...input,
      meta: null,
      outcome: evaluarPlan(params, null, scenarios)!,
      sensibilidad: null,
      aporteNecesario: null,
    })
    expect(() => JSON.parse(planAJSON(sinMeta))).not.toThrow()
  })
})

// ─── no goal ────────────────────────────────────────────────────────────────

describe('a plan with no goal', () => {
  const sinMeta = construirPlanExportable({
    ...input,
    meta: null,
    outcome: evaluarPlan(params, null, scenarios)!,
    sensibilidad: null,
    aporteNecesario: null,
  })

  it('still exports, saying there is no goal rather than inventing one', () => {
    expect(sinMeta.objetivo.monto).toBeNull()
    expect(sinMeta.probabilidad.alcanzarMetaPct).toBeNull()
    expect(sinMeta.sensibilidad).toBeNull()
  })

  it('still carries the mandatory sections', () => {
    const md = planAMarkdown(sinMeta)
    expect(md).toContain('## Supuestos y limitaciones del modelo')
    expect(md.toLowerCase()).toMatch(/no .{0,40}garant/)
    expect(md).not.toMatch(/NaN|Infinity|undefined/)
  })
})

// ─── filename ───────────────────────────────────────────────────────────────

describe('nombreArchivoPlan', () => {
  it('dates the file, so two exports do not collide silently', () => {
    expect(nombreArchivoPlan(plan, 'md')).toContain('2026-09-11')
  })

  it('uses the extension it was asked for', () => {
    expect(nombreArchivoPlan(plan, 'md').endsWith('.md')).toBe(true)
    expect(nombreArchivoPlan(plan, 'json').endsWith('.json')).toBe(true)
  })

  it('contains nothing a filesystem would object to', () => {
    expect(nombreArchivoPlan(plan, 'md')).toMatch(/^[a-z0-9._-]+$/)
  })
})
