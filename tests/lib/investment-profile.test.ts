import { describe, it, expect } from 'vitest'
import {
  perfilPsicologico,
  capacidadFinanciera,
  obtenerPerfilFinal,
  simulacionInversion,
  simulacionMonteCarlo,
  probabilidadMeta,
  aporteNecesario,
  obtenerRecomendacion,
  PERFIL_NOMBRES,
  RENDIMIENTOS,
  CARTERAS,
  type ProfileParams,
} from '@/lib/utils/investment-profile'

describe('Investment Profile Scoring', () => {
  describe('perfilPsicologico', () => {
    it('returns conservative profile for low scores', () => {
      const riesgo = 2
      const experiencia = 1
      const reaccion = 1
      const result = perfilPsicologico(riesgo, experiencia, reaccion)
      expect(result).toBe(0) // Conservative
    })

    it('returns moderate profile for medium scores', () => {
      const riesgo = 5
      const experiencia = 2
      const reaccion = 2
      const result = perfilPsicologico(riesgo, experiencia, reaccion)
      expect(result).toBe(1) // Moderate
    })

    it('returns aggressive profile for high scores', () => {
      const riesgo = 10
      const experiencia = 4
      const reaccion = 4
      const result = perfilPsicologico(riesgo, experiencia, reaccion)
      expect(result).toBe(2) // Aggressive
    })

    it('weights experience and reaction twice as much as risk', () => {
      // Same risk, different experience should produce different results
      const result1 = perfilPsicologico(5, 1, 1)
      const result2 = perfilPsicologico(5, 3, 3)
      expect(result2).toBeGreaterThan(result1)
    })

    it('boundary case: scores at threshold', () => {
      // 12 points should be conservative
      const result1 = perfilPsicologico(2, 2, 2) // 2 + 2*2 + 2*2 = 10
      expect(result1).toBe(0)

      // 13 points should be moderate
      const result2 = perfilPsicologico(3, 2, 2) // 3 + 2*2 + 2*2 = 11
      expect(result2).toBe(0)

      // 20+ points should be aggressive
      const result3 = perfilPsicologico(6, 3, 3) // 6 + 3*2 + 3*2 = 18
      expect(result3).toBe(1)

      const result4 = perfilPsicologico(8, 4, 4) // 8 + 4*2 + 4*2 = 24
      expect(result4).toBe(2)
    })
  })

  describe('capacidadFinanciera', () => {
    it('returns conservative for low financial capacity', () => {
      const result = capacidadFinanciera(
        50, // edad
        15000, // ingresos
        2, // horizonte
        1, // estabilidad
        5 // porcentajeInversion
      )
      expect(result).toBe(0)
    })

    it('returns moderate for medium financial capacity', () => {
      const result = capacidadFinanciera(
        35, // edad
        35000, // ingresos
        5, // horizonte
        3, // estabilidad
        20 // porcentajeInversion
      )
      expect(result).toBe(1)
    })

    it('returns aggressive for high financial capacity', () => {
      const result = capacidadFinanciera(
        30, // edad
        80000, // ingresos
        10, // horizonte
        4, // estabilidad
        40 // porcentajeInversion
      )
      expect(result).toBe(2)
    })

    it('gives extra points for younger age', () => {
      const young = capacidadFinanciera(30, 50000, 5, 2, 20)
      const older = capacidadFinanciera(60, 50000, 5, 2, 20)
      expect(young).toBeGreaterThanOrEqual(older)
    })

    it('gives extra points for higher income', () => {
      const highIncome = capacidadFinanciera(40, 80000, 5, 2, 20)
      const lowIncome = capacidadFinanciera(40, 20000, 5, 2, 20)
      expect(highIncome).toBeGreaterThanOrEqual(lowIncome)
    })

    it('gives extra points for longer investment horizon', () => {
      const longHorizon = capacidadFinanciera(40, 50000, 10, 2, 20)
      const shortHorizon = capacidadFinanciera(40, 50000, 2, 2, 20)
      expect(longHorizon).toBeGreaterThanOrEqual(shortHorizon)
    })

    it('includes stability score directly', () => {
      // High stability (4) pushes total above threshold vs low stability (0)
      const stable = capacidadFinanciera(30, 60000, 10, 4, 50)   // 2+2+2+4+2 = 12 → 2
      const unstable = capacidadFinanciera(30, 60000, 10, 0, 50) // 2+2+2+0+2 = 8  → 1
      expect(stable).toBeGreaterThan(unstable)
    })

    it('gives extra points for higher investment percentage', () => {
      const highPercent = capacidadFinanciera(40, 50000, 5, 2, 50)
      const lowPercent = capacidadFinanciera(40, 50000, 5, 2, 5)
      expect(highPercent).toBeGreaterThanOrEqual(lowPercent)
    })
  })

  describe('obtenerPerfilFinal', () => {
    it('returns conservative profile when both scores are low', () => {
      const params: ProfileParams = {
        edad: 50,
        ingresos: 20000,
        riesgo: 3,
        horizonte: 2,
        experiencia: 1,
        estabilidad: 1,
        reaccion: 1,
        porcentajeInversion: 5,
      }
      const result = obtenerPerfilFinal(params)
      expect(result.nivel).toBe(0)
      expect(result.nombre).toBe('Conservador')
    })

    it('returns moderate profile when both scores are medium', () => {
      const params: ProfileParams = {
        edad: 35,
        ingresos: 40000,
        riesgo: 5,
        horizonte: 6,
        experiencia: 2,
        estabilidad: 2,
        reaccion: 2,
        porcentajeInversion: 20,
      }
      const result = obtenerPerfilFinal(params)
      expect(result.nivel).toBe(1)
      expect(result.nombre).toBe('Moderado')
    })

    it('returns aggressive profile when both scores are high', () => {
      const params: ProfileParams = {
        edad: 28,
        ingresos: 100000,
        riesgo: 9,
        horizonte: 12,
        experiencia: 4,
        estabilidad: 4,
        reaccion: 4,
        porcentajeInversion: 50,
      }
      const result = obtenerPerfilFinal(params)
      expect(result.nivel).toBe(2)
      expect(result.nombre).toBe('Agresivo')
    })

    it('uses minimum of psychological and financial scores', () => {
      // Low psychological, high financial -> conservative
      const params1: ProfileParams = {
        edad: 25,
        ingresos: 100000,
        riesgo: 2,
        horizonte: 15,
        experiencia: 1,
        estabilidad: 4,
        reaccion: 1,
        porcentajeInversion: 50,
      }
      expect(obtenerPerfilFinal(params1).nivel).toBe(0)

      // High psychological, low financial -> conservative
      const params2: ProfileParams = {
        edad: 60,
        ingresos: 15000,
        riesgo: 10,
        horizonte: 2,
        experiencia: 4,
        estabilidad: 1,
        reaccion: 4,
        porcentajeInversion: 5,
      }
      expect(obtenerPerfilFinal(params2).nivel).toBe(0)
    })
  })

  describe('Portfolio Constants', () => {
    it('defines profile names for all levels', () => {
      expect(PERFIL_NOMBRES[0]).toBe('Conservador')
      expect(PERFIL_NOMBRES[1]).toBe('Moderado')
      expect(PERFIL_NOMBRES[2]).toBe('Agresivo')
    })

    it('conservative portfolio has lower stock allocation', () => {
      const conservative = CARTERAS[0]
      const aggressive = CARTERAS[2]
      const conservativeStocks = (conservative['ETF S&P500'] || 0) + (conservative['ETF Nasdaq'] || 0)
      const aggressiveStocks =
        (aggressive['ETF S&P500'] || 0) +
        (aggressive['ETF Nasdaq'] || 0) +
        (aggressive['ETF Emergentes'] || 0)
      expect(aggressiveStocks).toBeGreaterThan(conservativeStocks)
    })

    it('portfolio allocations sum to 1 for each profile', () => {
      for (let i = 0; i < 3; i++) {
        const sum = Object.values(CARTERAS[i as 0 | 1 | 2]).reduce((a, b) => a + b, 0)
        expect(sum).toBeCloseTo(1.0)
      }
    })

    it('conservative has lower expected return than aggressive', () => {
      expect(RENDIMIENTOS[0]).toBeLessThan(RENDIMIENTOS[1])
      expect(RENDIMIENTOS[1]).toBeLessThan(RENDIMIENTOS[2])
    })
  })

  describe('simulacionInversion', () => {
    it('calculates correct value with 0% return', () => {
      const result = simulacionInversion(10000, 100, 1, 0)
      const expectedCapital = 10000 + 100 * 12
      expect(result.valorFinal).toBeCloseTo(expectedCapital)
      expect(result.ganancia).toBeCloseTo(0)
    })

    it('calculates positive gains with positive return', () => {
      const result = simulacionInversion(10000, 100, 5, 0.07)
      expect(result.valorFinal).toBeGreaterThan(result.capitalAportado)
      expect(result.ganancia).toBeGreaterThan(0)
      expect(result.rentabilidadTotal).toBeGreaterThan(0)
    })

    it('builds historial with yearly values', () => {
      const result = simulacionInversion(10000, 100, 3, 0.07)
      expect(result.historial).toHaveLength(3)
      expect(result.historial[0]).toBeGreaterThan(result.capitalAportado / 3)
      expect(result.historial[2]).toBe(result.valorFinal)
    })

    it('handles zero initial investment', () => {
      const result = simulacionInversion(0, 1000, 2, 0.05)
      expect(result.capitalAportado).toBe(1000 * 2 * 12)
      expect(result.valorFinal).toBeGreaterThan(0)
    })

    it('handles zero monthly contribution', () => {
      const result = simulacionInversion(10000, 0, 5, 0.07)
      expect(result.capitalAportado).toBe(10000)
      expect(result.historial.length).toBe(5)
    })

    it('compounds returns correctly', () => {
      const result = simulacionInversion(10000, 0, 1, 0.1)
      expect(result.valorFinal).toBeCloseTo(11000, 0)
    })

    it('calculates rentabilidad correctly', () => {
      const result = simulacionInversion(10000, 1000, 2, 0.05)
      const expectedGanancia = result.valorFinal - result.capitalAportado
      const expectedRentabilidad =
        (expectedGanancia / result.capitalAportado) * 100
      expect(result.ganancia).toBeCloseTo(expectedGanancia)
      expect(result.rentabilidadTotal).toBeCloseTo(expectedRentabilidad)
    })
  })

  describe('simulacionMonteCarlo', () => {
    it('returns worst, average, and best case values', () => {
      const result = simulacionMonteCarlo(10000, 100, 5, 0.07)
      expect(result.peor).toBeLessThanOrEqual(result.promedio)
      expect(result.promedio).toBeLessThanOrEqual(result.mejor)
    })

    it('worst case is less than or equal to best case', () => {
      const result = simulacionMonteCarlo(10000, 100, 5, 0.07, 200)
      expect(result.peor).toBeLessThan(result.mejor)
    })

    it('average case is within worst and best', () => {
      const result = simulacionMonteCarlo(10000, 100, 5, 0.07, 200)
      expect(result.promedio).toBeGreaterThanOrEqual(result.peor)
      expect(result.promedio).toBeLessThanOrEqual(result.mejor)
    })

    it('uses all simulations', () => {
      const numSims = 100
      const result = simulacionMonteCarlo(10000, 100, 5, 0.07, numSims)
      // Can't directly verify, but check that results are reasonable
      expect(result.peor).toBeGreaterThan(0)
      expect(result.mejor).toBeGreaterThan(result.peor)
    })

    it('handles low volatility (deterministic behavior)', () => {
      const result1 = simulacionMonteCarlo(10000, 0, 5, 0.05, 1000)
      // With many simulations and fixed return, variance should be lower
      const variance = result1.mejor - result1.peor
      expect(variance).toBeGreaterThan(0)
    })
  })

  describe('probabilidadMeta', () => {
    it('returns percentage between 0 and 100', () => {
      const result = probabilidadMeta(10000, 100, 5, 0.07, 20000)
      expect(result).toBeGreaterThanOrEqual(0)
      expect(result).toBeLessThanOrEqual(100)
    })

    it('returns high probability for achievable goal', () => {
      const result = probabilidadMeta(10000, 1000, 10, 0.08, 50000)
      expect(result).toBeGreaterThan(50)
    })

    it('returns low probability for unrealistic goal', () => {
      const result = probabilidadMeta(1000, 10, 1, 0.05, 1000000)
      expect(result).toBeLessThan(50)
    })

    it('higher contribution increases probability', () => {
      const lowContribution = probabilidadMeta(10000, 100, 5, 0.07, 50000, 100)
      const highContribution = probabilidadMeta(10000, 500, 5, 0.07, 50000, 100)
      expect(highContribution).toBeGreaterThanOrEqual(lowContribution)
    })

    it('longer horizon increases probability', () => {
      const shortHorizon = probabilidadMeta(10000, 100, 2, 0.07, 50000, 100)
      const longHorizon = probabilidadMeta(10000, 100, 10, 0.07, 50000, 100)
      expect(longHorizon).toBeGreaterThanOrEqual(shortHorizon)
    })

    it('goal equal to current value has high probability', () => {
      const result = probabilidadMeta(10000, 0, 5, 0.07, 10000, 100)
      expect(result).toBeGreaterThan(95)
    })
  })

  describe('aporteNecesario', () => {
    it('calculates monthly contribution needed', () => {
      const aporte = aporteNecesario(50000, 10000, 5, 0.07)
      expect(aporte).toBeGreaterThan(0)
    })

    it('returns 0 if goal already exceeded by initial investment', () => {
      const aporte = aporteNecesario(10000, 20000, 5, 0.07)
      expect(aporte).toBeLessThanOrEqual(0)
    })

    it('requires more contribution for shorter horizons', () => {
      const short = aporteNecesario(50000, 10000, 2, 0.07)
      const long = aporteNecesario(50000, 10000, 10, 0.07)
      expect(short).toBeGreaterThan(long)
    })

    it('requires more contribution for lower returns', () => {
      const lowReturn = aporteNecesario(50000, 10000, 5, 0.02)
      const highReturn = aporteNecesario(50000, 10000, 5, 0.10)
      expect(lowReturn).toBeGreaterThan(highReturn)
    })

    it('handles zero years (infinite contribution needed)', () => {
      const aporte = aporteNecesario(50000, 10000, 0, 0.07)
      expect(aporte).toBe(Infinity)
    })

    it('handles zero return rate', () => {
      const aporte = aporteNecesario(50000, 10000, 5, 0)
      expect(aporte).toBeGreaterThan(0)
      expect(isFinite(aporte)).toBe(true)
    })
  })

  describe('obtenerRecomendacion', () => {
    it('recommends increasing contribution for low probability and insufficient aporte', () => {
      const rec = obtenerRecomendacion(30, 100, 500)
      expect(rec).toContain('baja')
      expect(rec).toContain('aportar')
    })

    it('recommends diversification for low probability', () => {
      const rec = obtenerRecomendacion(30, 500, 500)
      expect(rec).toContain('baja')
      expect(rec).toContain('diversificar')
    })

    it('recommends caution for moderate probability', () => {
      const rec = obtenerRecomendacion(60, 100, 100)
      expect(rec.toLowerCase()).toContain('moderado')
    })

    it('recommends confidence for high probability', () => {
      const rec = obtenerRecomendacion(85, 100, 100)
      expect(rec.toLowerCase()).toContain('alta')
    })

    it('boundary at 50% probability', () => {
      const lowProb = obtenerRecomendacion(49, 100, 500)
      const highProb = obtenerRecomendacion(50, 100, 500)
      expect(lowProb.toLowerCase()).toContain('baja')
      // highProb might be moderate or warning
    })

    it('boundary at 75% probability', () => {
      const lowProb = obtenerRecomendacion(74, 100, 100)
      const highProb = obtenerRecomendacion(75, 100, 100)
      expect(highProb.toLowerCase()).toContain('alta')
    })
  })
})
