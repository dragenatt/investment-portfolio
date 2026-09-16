import useSWR from 'swr'
import { apiFetcher } from '@/lib/api/fetcher'
import type { GoalTracking } from '@/lib/services/goal-tracking'
import type { CreateGoalInput, CreateProjectionInput, UpdateGoalInput } from '@/lib/schemas/goal'

// Client side of P1-8/P1-9. The API, the tables, their RLS and the tracking
// maths all existed with nothing calling them; these are the calls.

export type GoalStatus = 'active' | 'reached' | 'paused' | 'cancelled'

export type Goal = {
  id: string
  name: string
  description: string | null
  portfolio_id: string | null
  target_amount: number
  currency: 'MXN' | 'USD' | 'EUR'
  start_date: string
  target_date: string
  starting_capital: number
  monthly_contribution: number
  risk_profile: 'Conservador' | 'Moderado' | 'Agresivo' | null
  expected_annual_return: number | null
  expected_annual_volatility: number | null
  status: GoalStatus
  created_at: string
  updated_at: string
}

export type GoalWithTracking = Goal & { tracking: GoalTracking | null }

export type GoalProjection = CreateProjectionInput & {
  id: string
  goal_id: string
  created_at: string
}

export type GoalDetail = {
  goal: Goal
  projections: GoalProjection[]
  tracking: GoalTracking | null
}

export function useGoals() {
  return useSWR<GoalWithTracking[]>('/api/goals', apiFetcher, { refreshInterval: 300_000 })
}

export function useGoal(id: string | null) {
  return useSWR<GoalDetail>(id ? `/api/goals/${id}` : null, apiFetcher, { refreshInterval: 300_000 })
}

/** A JSON request that throws the API's own error message on failure. */
async function send<T>(url: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json = await res.json().catch(() => null)
  if (!res.ok || !json || json.error) {
    throw new Error(json?.error ?? `Error del servidor (${res.status})`)
  }
  return json.data as T
}

export const goalActions = {
  create: (goal: CreateGoalInput & { projection?: CreateProjectionInput }) =>
    send<Goal & { projection_saved: boolean | null }>('/api/goals', 'POST', goal),
  update: (id: string, changes: UpdateGoalInput) => send<Goal>(`/api/goals/${id}`, 'PATCH', changes),
  duplicate: (id: string) => send<Goal>(`/api/goals/${id}`, 'POST'),
  remove: (id: string) => send<{ deleted: true }>(`/api/goals/${id}`, 'DELETE'),
  addProjection: (id: string, projection: CreateProjectionInput) =>
    send<GoalProjection>(`/api/goals/${id}/projections`, 'POST', projection),
}

export const GOAL_STATUS_LABELS: Record<GoalStatus, string> = {
  active: 'Activa',
  reached: 'Alcanzada',
  paused: 'Pausada',
  cancelled: 'Cancelada',
}

export const PACE_LABELS: Record<GoalTracking['pace'], string> = {
  ahead: 'Adelantada',
  'on-track': 'En línea',
  behind: 'Atrasada',
  unknown: 'Sin datos',
}
