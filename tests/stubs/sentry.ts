// Vitest stub for @sentry/nextjs.
//
// The real SDK loads bundler-specific code (@sentry/server-utils' webpack
// entry) that has no business running inside a unit test, and throws when it
// does. Aliased in vitest.config.ts so importing lib/api/handler stays cheap
// and hermetic — the tests assert response shapes, not error reporting.

export function captureException(): void {}
export function captureRequestError(): void {}
export function captureRouterTransitionStart(): void {}
export function init(): void {}
