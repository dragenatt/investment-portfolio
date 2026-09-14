import useSWR from 'swr'
import { apiFetcher } from '@/lib/api/fetcher'
import { useDebounce } from './use-debounce'
import { labQueryString } from '@/lib/utils/lab-format'
import type { ChartSpec, ExperimentId, ExperimentResult, ParamSpec } from '@/lib/services/lab'

// --- Financial laboratory (E1) ---

export type LabCatalogueEntry = {
  id: ExperimentId
  title: string
  objective: string
  concept: string
  params: ParamSpec[]
  simulation: string
  questions: string[]
  available: boolean
  unavailableReason: string | null
  defaults: Record<string, number>
}

export type LabRun = {
  id: ExperimentId
  used: Record<string, number>
  available: boolean
  result: ExperimentResult | null
}

export type { ChartSpec, ExperimentResult, ParamSpec }

export function useLabCatalogue() {
  // The catalogue only changes on deploy.
  return useSWR<LabCatalogueEntry[]>('/api/lab', apiFetcher, { revalidateOnFocus: false })
}

/**
 * One experiment's result for a set of slider values.
 *
 * Debounced so dragging a slider asks once when it settles rather than once per
 * pixel, and keeps the previous result on screen while the next one loads — a
 * chart that blanks on every nudge is impossible to read as a relationship.
 */
export function useLabRun(id: ExperimentId | null, params: Record<string, number> | null) {
  const settled = useDebounce(params, 200)
  const key = id && settled ? `/api/lab?${labQueryString(id, settled)}` : null
  return useSWR<LabRun>(key, apiFetcher, {
    keepPreviousData: true,
    revalidateOnFocus: false,
  })
}
