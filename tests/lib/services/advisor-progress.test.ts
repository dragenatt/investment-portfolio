import { describe, it, expect } from 'vitest'
import {
  crearProgreso,
  etapasIniciales,
  ETAPAS_ADVISOR,
  type Etapa,
} from '@/lib/services/advisor-progress'

/** A clock the test drives, so no assertion depends on how fast the box is. */
function relojFalso() {
  let t = 0
  return { ahora: () => t, avanzar: (ms: number) => (t += ms) }
}

/** A yield that resolves immediately; the real one waits for a paint. */
const cederYa = () => Promise.resolve()

describe('etapasIniciales', () => {
  it('has one entry per stage the roadmap names', () => {
    expect(etapasIniciales().map((e) => e.id)).toEqual([...ETAPAS_ADVISOR])
  })

  it('names the five stages the roadmap lists', () => {
    expect([...ETAPAS_ADVISOR]).toEqual([
      'preparando',
      'calculando',
      'simulando',
      'analizando-meta',
      'recomendando',
    ])
  })

  it('starts everything pending, with no duration invented', () => {
    for (const etapa of etapasIniciales()) {
      expect(etapa.estado).toBe('pendiente')
      expect(etapa.ms).toBeNull()
    }
  })
})

describe('crearProgreso', () => {
  it('returns whatever the work returns', async () => {
    const progreso = crearProgreso(() => {}, { ceder: cederYa })
    await expect(progreso.etapa('preparando', () => 42)).resolves.toBe(42)
  })

  it('marks a stage active before running it and ready after', async () => {
    const visto: Etapa[][] = []
    const progreso = crearProgreso((e) => visto.push(e), { ceder: cederYa })

    await progreso.etapa('simulando', () => 'listo')

    const estadosDeSimulando = visto.map((e) => e.find((x) => x.id === 'simulando')!.estado)
    expect(estadosDeSimulando).toEqual(['activa', 'lista'])
  })

  it('never reports a stage as ready before its work has run', async () => {
    // The whole point of D6: the label on screen must describe work actually
    // happening, not a script of labels played back on a timer.
    let corrio = false
    let readyAntesDeCorrer = false
    const progreso = crearProgreso(
      (etapas) => {
        if (etapas.find((e) => e.id === 'calculando')!.estado === 'lista' && !corrio) {
          readyAntesDeCorrer = true
        }
      },
      { ceder: cederYa },
    )

    await progreso.etapa('calculando', () => {
      corrio = true
    })

    expect(corrio).toBe(true)
    expect(readyAntesDeCorrer).toBe(false)
  })

  it('reports the real duration, measured rather than assumed', async () => {
    const reloj = relojFalso()
    const progreso = crearProgreso(() => {}, { ahora: reloj.ahora, ceder: cederYa })

    await progreso.etapa('simulando', () => reloj.avanzar(37))

    expect(progreso.etapas().find((e) => e.id === 'simulando')!.ms).toBe(37)
  })

  it('adds no time of its own', async () => {
    // If this ever fails, something is padding the wait again.
    const reloj = relojFalso()
    const progreso = crearProgreso(() => {}, { ahora: reloj.ahora, ceder: cederYa })

    await progreso.etapa('preparando', () => reloj.avanzar(5))
    await progreso.etapa('calculando', () => reloj.avanzar(10))

    const total = progreso
      .etapas()
      .reduce((sum, etapa) => sum + (etapa.ms ?? 0), 0)
    expect(total).toBe(15)
    expect(reloj.ahora()).toBe(15)
  })

  it('keeps the stages in the declared order however they are run', async () => {
    const progreso = crearProgreso(() => {}, { ceder: cederYa })
    await progreso.etapa('recomendando', () => null)
    await progreso.etapa('preparando', () => null)
    expect(progreso.etapas().map((e) => e.id)).toEqual([...ETAPAS_ADVISOR])
  })

  it('leaves stages that have not run pending', async () => {
    const progreso = crearProgreso(() => {}, { ceder: cederYa })
    await progreso.etapa('preparando', () => null)
    const simulando = progreso.etapas().find((e) => e.id === 'simulando')!
    expect(simulando.estado).toBe('pendiente')
    expect(simulando.ms).toBeNull()
  })
})

describe('when a stage fails', () => {
  it('marks it failed rather than leaving a spinner running', async () => {
    const progreso = crearProgreso(() => {}, { ceder: cederYa })
    await expect(
      progreso.etapa('simulando', () => {
        throw new Error('sin datos')
      }),
    ).rejects.toThrow('sin datos')
    expect(progreso.etapas().find((e) => e.id === 'simulando')!.estado).toBe('fallida')
  })

  it('still records how long it ran before failing', async () => {
    const reloj = relojFalso()
    const progreso = crearProgreso(() => {}, { ahora: reloj.ahora, ceder: cederYa })
    await expect(
      progreso.etapa('simulando', () => {
        reloj.avanzar(12)
        throw new Error('roto')
      }),
    ).rejects.toThrow()
    expect(progreso.etapas().find((e) => e.id === 'simulando')!.ms).toBe(12)
  })

  it('rethrows, so the caller decides rather than the progress tracker', async () => {
    const progreso = crearProgreso(() => {}, { ceder: cederYa })
    await expect(progreso.etapa('preparando', () => { throw new Error('x') })).rejects.toThrow('x')
  })
})

describe('yielding', () => {
  it('yields once before each stage, so the label can paint before work blocks', async () => {
    let cesiones = 0
    const progreso = crearProgreso(() => {}, {
      ceder: () => {
        cesiones++
        return Promise.resolve()
      },
    })
    await progreso.etapa('preparando', () => null)
    await progreso.etapa('calculando', () => null)
    expect(cesiones).toBe(2)
  })

  it('yields after reporting the stage active, not before', async () => {
    // Yielding first would paint the previous label for a frame, which is the
    // subtle version of showing a stage that is not running.
    const orden: string[] = []
    const progreso = crearProgreso(() => orden.push('reporte'), {
      ceder: () => {
        orden.push('cede')
        return Promise.resolve()
      },
    })
    await progreso.etapa('preparando', () => orden.push('trabajo'))
    expect(orden.slice(0, 3)).toEqual(['reporte', 'cede', 'trabajo'])
  })
})
