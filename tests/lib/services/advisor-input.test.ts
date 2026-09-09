import { describe, it, expect } from 'vitest'
import { validarEntradasAdvisor, type EntradasAdvisor } from '@/lib/services/advisor'

const valid: EntradasAdvisor = {
  edad: 30,
  ingresos: 40000,
  horizonte: 10,
  capitalInicial: 50000,
  aportacionMensual: 3000,
  meta: 1000000,
  porcentajeInversion: 20,
  riesgo: 5,
  experiencia: 2,
  estabilidad: 3,
  reaccion: 2,
}

const expectRejects = (patch: Partial<EntradasAdvisor>, field: string) => {
  const result = validarEntradasAdvisor({ ...valid, ...patch })
  expect(result.valid).toBe(false)
  expect(result.errors.map((e) => e.field)).toContain(field)
}

describe('validarEntradasAdvisor', () => {
  it('accepts a well-formed set of answers', () => {
    const result = validarEntradasAdvisor(valid)
    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('rejects an age nobody investing has', () => {
    expectRejects({ edad: 0 }, 'edad')
    expectRejects({ edad: -5 }, 'edad')
    expectRejects({ edad: 130 }, 'edad')
  })

  it('accepts the age boundaries', () => {
    expect(validarEntradasAdvisor({ ...valid, edad: 18 }).valid).toBe(true)
    expect(validarEntradasAdvisor({ ...valid, edad: 100 }).valid).toBe(true)
  })

  it('rejects negative income', () => {
    expectRejects({ ingresos: -1 }, 'ingresos')
  })

  it('rejects a horizon of zero or less', () => {
    expectRejects({ horizonte: 0 }, 'horizonte')
    expectRejects({ horizonte: -3 }, 'horizonte')
  })

  it('rejects a horizon longer than a lifetime of investing', () => {
    expectRejects({ horizonte: 101 }, 'horizonte')
  })

  it('rejects negative capital and negative contributions', () => {
    expectRejects({ capitalInicial: -1 }, 'capitalInicial')
    expectRejects({ aportacionMensual: -1 }, 'aportacionMensual')
  })

  it('accepts zero capital and zero contributions — starting from nothing is valid', () => {
    expect(validarEntradasAdvisor({ ...valid, capitalInicial: 0 }).valid).toBe(true)
    expect(validarEntradasAdvisor({ ...valid, aportacionMensual: 0 }).valid).toBe(true)
  })

  it('rejects a goal of zero or less', () => {
    expectRejects({ meta: 0 }, 'meta')
    expectRejects({ meta: -100 }, 'meta')
  })

  it('keeps percentages inside 0-100', () => {
    expectRejects({ porcentajeInversion: -1 }, 'porcentajeInversion')
    expectRejects({ porcentajeInversion: 101 }, 'porcentajeInversion')
    expect(validarEntradasAdvisor({ ...valid, porcentajeInversion: 0 }).valid).toBe(true)
    expect(validarEntradasAdvisor({ ...valid, porcentajeInversion: 100 }).valid).toBe(true)
  })

  it('keeps the questionnaire scales inside their ranges', () => {
    expectRejects({ riesgo: 0 }, 'riesgo')
    expectRejects({ riesgo: 11 }, 'riesgo')
    expectRejects({ experiencia: 0 }, 'experiencia')
    expectRejects({ experiencia: 5 }, 'experiencia')
    expectRejects({ estabilidad: 5 }, 'estabilidad')
    expectRejects({ reaccion: 5 }, 'reaccion')
  })

  it('rejects anything that is not a finite number', () => {
    expectRejects({ meta: Number.NaN }, 'meta')
    expectRejects({ capitalInicial: Number.POSITIVE_INFINITY }, 'capitalInicial')
  })

  it('reports every problem at once rather than one at a time', () => {
    const result = validarEntradasAdvisor({ ...valid, edad: -1, meta: 0, horizonte: 0 })
    expect(result.errors.length).toBeGreaterThanOrEqual(3)
  })

  it('explains each problem in words the form can show', () => {
    const result = validarEntradasAdvisor({ ...valid, edad: -1 })
    expect(result.errors[0].message.length).toBeGreaterThan(10)
  })

  it('warns without rejecting when the contribution swallows the income', () => {
    // Mathematically fine, financially alarming: flag it, do not block it
    const result = validarEntradasAdvisor({ ...valid, ingresos: 10000, aportacionMensual: 9000 })
    expect(result.valid).toBe(true)
    expect(result.warnings.length).toBeGreaterThan(0)
    expect(result.warnings[0].message).toMatch(/ingreso/i)
  })

  it('does not warn about an ordinary savings rate', () => {
    expect(validarEntradasAdvisor(valid).warnings).toEqual([])
  })
})
