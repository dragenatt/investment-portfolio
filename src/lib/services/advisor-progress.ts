// D6 — real progress for the advisor, rather than a script played on a timer.
//
// The page used to wrap the whole analysis in setTimeout(..., 1500) and show one
// label for the duration. That is the thing the roadmap asks to remove: the
// delay existed only to make the work look like work, and the label was true
// only by coincidence.
//
// The analysis is genuinely CPU-bound and synchronous — a thousand Monte Carlo
// paths, a contribution solve, then a six-way sensitivity sweep — so the honest
// version reports each stage as it begins and records how long it actually
// took. If the whole thing finishes in 200ms the user sees 200ms of stages,
// because that is the truth.
//
// About the yield. Synchronous work blocks the main thread, so a setState just
// before it never paints: the label would appear only after the work it
// describes had finished. `ceder` hands control back for one turn of the event
// loop so the browser can paint the label it was just given. That is not the
// artificial delay being removed — it adds one frame, not a second and a half,
// and without it the stage labels are decorative. A test pins that the tracker
// contributes no time of its own.
//
// No Web Worker: there is no worker infrastructure in this project to reuse, and
// introducing one for a couple of hundred milliseconds would be new
// infrastructure for no gain.

export type EtapaId =
  | 'preparando'
  | 'calculando'
  | 'simulando'
  | 'analizando-meta'
  | 'recomendando'

/** The five the roadmap names, in the order they run. */
export const ETAPAS_ADVISOR: readonly EtapaId[] = [
  'preparando',
  'calculando',
  'simulando',
  'analizando-meta',
  'recomendando',
] as const

export type EstadoEtapa = 'pendiente' | 'activa' | 'lista' | 'fallida'

export type Etapa = {
  id: EtapaId
  estado: EstadoEtapa
  /** Milliseconds actually spent. Null until the stage has run. */
  ms: number | null
}

export function etapasIniciales(ids: readonly EtapaId[] = ETAPAS_ADVISOR): Etapa[] {
  return ids.map((id) => ({ id, estado: 'pendiente', ms: null }))
}

export type ReportarProgreso = (etapas: Etapa[]) => void

export type OpcionesProgreso = {
  /** Injected so tests do not depend on how fast the machine is. */
  ahora?: () => number
  /** Injected so tests do not wait on the event loop. */
  ceder?: () => Promise<void>
  ids?: readonly EtapaId[]
}

/** One turn of the event loop, which is all the browser needs to paint. */
const cederAlNavegador = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

const ahoraPorDefecto = () =>
  typeof performance !== 'undefined' ? performance.now() : Date.now()

export function crearProgreso(reportar: ReportarProgreso, opciones?: OpcionesProgreso) {
  const ahora = opciones?.ahora ?? ahoraPorDefecto
  const ceder = opciones?.ceder ?? cederAlNavegador
  let etapas = etapasIniciales(opciones?.ids)

  const actualizar = (id: EtapaId, cambios: Partial<Etapa>) => {
    etapas = etapas.map((etapa) => (etapa.id === id ? { ...etapa, ...cambios } : etapa))
    reportar(etapas)
  }

  return {
    /**
     * Run one stage: announce it, let the announcement paint, do the work,
     * record what it actually cost.
     *
     * A failure marks the stage failed and rethrows — the caller decides what
     * to do, rather than the progress tracker swallowing it and leaving a
     * spinner turning forever.
     */
    async etapa<T>(id: EtapaId, trabajo: () => T): Promise<T> {
      actualizar(id, { estado: 'activa', ms: null })
      await ceder()

      const inicio = ahora()
      try {
        const resultado = trabajo()
        actualizar(id, { estado: 'lista', ms: ahora() - inicio })
        return resultado
      } catch (error) {
        actualizar(id, { estado: 'fallida', ms: ahora() - inicio })
        throw error
      }
    },

    etapas: () => etapas,
  }
}
