// Browser instrumentation entry point.
//
// This is where client-side Sentry lives in Next 16: sentry.client.config.ts is
// the older convention, superseded by instrumentation-client.ts, which runs
// before the app becomes interactive. See
// node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation-client.md
//
// The browser can only read NEXT_PUBLIC_ variables, so the client DSN is a
// separate one from the server's SENTRY_DSN.
//
// ── Why the SDK is imported dynamically, and only with a DSN (C3) ────────────
//
// This file used to `import * as Sentry` at the top and call init with
// `enabled: Boolean(dsn)`. NEXT_PUBLIC_SENTRY_DSN is not set in production, so
// the built init was `enabled: false` — and the SDK was still bundled: 454 KB
// (139 KB gzip), the largest chunk in the app, downloaded and parsed on every
// page for an error reporter that could never report.
//
// NEXT_PUBLIC_ variables are inlined at build time, so with no DSN the branch
// below is dead code and the bundler drops the import entirely. With a DSN the
// SDK loads in its own chunk right after this file runs. The trade-off is that
// an error thrown in the few milliseconds before that chunk arrives is not
// captured; the server-side SDK is unaffected.

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN

type RouterTransition = (href: string, navigationType: 'push' | 'replace' | 'traverse') => void

let captureRouterTransition: RouterTransition | null = null

if (dsn) {
  import('@sentry/nextjs')
    .then((Sentry) => {
      Sentry.init({
        dsn,
        tracesSampleRate: 0.1,
        sendDefaultPii: false,
        environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
      })
      captureRouterTransition = Sentry.captureRouterTransitionStart
    })
    .catch(() => {
      // Monitoring failing to load must never break the app it monitors.
    })
}

// Lets Sentry tie a client-side error to the navigation that caused it, once
// the SDK has loaded; before that, and without a DSN, it does nothing.
export function onRouterTransitionStart(href: string, navigationType: 'push' | 'replace' | 'traverse') {
  captureRouterTransition?.(href, navigationType)
}
