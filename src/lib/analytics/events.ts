// The funnel vocabulary — runtime-agnostic on purpose.
//
// Constants and types only, with no SDK import, so a client component can name
// an event without dragging posthog-node into the browser bundle (and vice
// versa). The SDK wrappers live in ./posthog.

export const FUNNEL_EVENTS = {
  ACCOUNT_CREATED: 'cuenta_creada',
  PORTFOLIO_CREATED: 'portafolio_creado',
  FIRST_MONTE_CARLO: 'primera_simulacion_montecarlo',
  /** Reserved for P1-1 (backtesting). Nothing emits this yet. */
  BACKTEST_RUN: 'simulacion_backtesting_ejecutada',
} as const

export type FunnelEvent = (typeof FUNNEL_EVENTS)[keyof typeof FUNNEL_EVENTS]

export const FUNNEL_EVENT_NAMES: FunnelEvent[] = Object.values(FUNNEL_EVENTS)

/** Steps that only count once per user. See the partial unique index in 012. */
export const ONCE_PER_USER_EVENTS: FunnelEvent[] = [
  FUNNEL_EVENTS.ACCOUNT_CREATED,
  FUNNEL_EVENTS.FIRST_MONTE_CARLO,
]

/**
 * Primitives only. Anything richer would make it too easy to attach an object
 * that happens to carry user input.
 */
export type EventProperties = Record<string, string | number | boolean>

export function isFunnelEvent(value: unknown): value is FunnelEvent {
  return typeof value === 'string' && (FUNNEL_EVENT_NAMES as string[]).includes(value)
}

/** Human labels for the /admin/metrics table, in funnel order. */
export const FUNNEL_LABELS: Record<FunnelEvent, string> = {
  cuenta_creada: 'Cuenta creada',
  portafolio_creado: 'Portafolio creado',
  primera_simulacion_montecarlo: 'Primera simulación Monte Carlo',
  simulacion_backtesting_ejecutada: 'Backtesting ejecutado',
}
