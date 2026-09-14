'use client'

import { useReportWebVitals } from 'next/web-vitals'
import { shouldReportVitals } from '@/lib/services/web-vitals'

type Metric = Parameters<Parameters<typeof useReportWebVitals>[0]>[0]

// Module-level, so the callback reference never changes: the hook replays every
// metric collected so far to each new callback it is given.
function report(metric: Metric) {
  if (
    !shouldReportVitals({
      hostname: window.location.hostname,
      webdriver: navigator.webdriver,
      framed: window.top !== window.self,
    })
  ) {
    return
  }
  const body = JSON.stringify({
    name: metric.name,
    value: metric.value,
    rating: metric.rating,
    navigationType: metric.navigationType,
    // The server collapses ids and symbols; the query string is never sent.
    route: window.location.pathname,
  })
  // sendBeacon survives the page being closed, which is when CLS and INP are
  // final. fetch with keepalive is the fallback where beacons are unavailable.
  if (!navigator.sendBeacon?.('/api/analytics/vitals', new Blob([body], { type: 'application/json' }))) {
    void fetch('/api/analytics/vitals', { method: 'POST', body, keepalive: true, headers: { 'Content-Type': 'application/json' } }).catch(() => {})
  }
}

/** Reports LCP, CLS, INP, FCP and TTFB from real page views (C3). Renders nothing. */
export function WebVitalsReporter() {
  useReportWebVitals(report)
  return null
}
