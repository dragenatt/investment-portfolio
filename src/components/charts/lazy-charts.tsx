'use client'

// Charts, loaded on demand (C3).
//
// Recharts and the d3 modules under it are ~92 KB gzip. Imported statically,
// each page that drew a chart carried its own copy in its first-load bundle —
// the build had six near-identical 314 KB chunks, one per route — so the page's
// text and numbers waited on a charting library, and moving between two chart
// pages downloaded it again under a different file name.
//
// Imported through here, the charts arrive in their own chunk after the page is
// interactive, shared by every route that uses them. `ssr: false` because every
// chart measures its container in the browser; none rendered meaningfully on
// the server. The placeholder is the same skeleton the cards already show while
// their data loads, at the same height, so the swap does not shift the layout.

import dynamic from 'next/dynamic'
import { SkeletonChart } from '@/components/shared/skeleton-chart'

const loading = () => <SkeletonChart />

export const AllocationDonut = dynamic(
  () => import('@/components/dashboard/allocation-donut').then((m) => m.AllocationDonut),
  { ssr: false, loading },
)
export const PortfolioChart = dynamic(
  () => import('@/components/dashboard/portfolio-chart').then((m) => m.PortfolioChart),
  { ssr: false, loading },
)
export const DrawdownChart = dynamic(
  () => import('@/components/analytics/drawdown-chart').then((m) => m.DrawdownChart),
  { ssr: false, loading },
)
export const AttributionWaterfall = dynamic(
  () => import('@/components/analytics/attribution-waterfall').then((m) => m.AttributionWaterfall),
  { ssr: false, loading },
)
export const TemporalAttribution = dynamic(
  () => import('@/components/analytics/temporal-attribution').then((m) => m.TemporalAttribution),
  { ssr: false, loading },
)
export const ModelComparison = dynamic(
  () => import('@/components/analytics/model-comparison').then((m) => m.ModelComparison),
  { ssr: false, loading },
)
export const RiskSources = dynamic(
  () => import('@/components/analytics/risk-sources').then((m) => m.RiskSources),
  { ssr: false, loading },
)
export const IncomeDashboard = dynamic(
  () => import('@/components/analytics/income-dashboard').then((m) => m.IncomeDashboard),
  { ssr: false, loading },
)
export const MonteCarloChart = dynamic(
  () => import('@/components/analytics/monte-carlo-chart').then((m) => m.MonteCarloChart),
  { ssr: false, loading },
)
export const RollingRiskChart = dynamic(
  () => import('@/components/analytics/rolling-risk-chart').then((m) => m.RollingRiskChart),
  { ssr: false, loading },
)
export const FactorExposure = dynamic(
  () => import('@/components/analytics/factor-exposure').then((m) => m.FactorExposure),
  { ssr: false, loading },
)
export const EfficientFrontierChart = dynamic(
  () => import('@/components/analytics/efficient-frontier-chart').then((m) => m.EfficientFrontierChart),
  { ssr: false, loading },
)
export const PriceChart = dynamic(
  () => import('@/components/market/price-chart').then((m) => m.PriceChart),
  { ssr: false, loading },
)
export const StrategyBuilder = dynamic(
  () => import('@/components/market/strategy-builder').then((m) => m.StrategyBuilder),
  { ssr: false, loading },
)
// Already inside a lab card, so a bare block at the chart's own height rather
// than a second card.
export const ExperimentChart = dynamic(
  () => import('@/components/lab/experiment-chart').then((m) => m.ExperimentChart),
  { ssr: false, loading: () => <div className="h-[280px] rounded-xl bg-muted/40 animate-pulse" /> },
)
export const AdvisorAllocationDonut = dynamic(
  () => import('@/components/advisor/advisor-charts').then((m) => m.AdvisorAllocationDonut),
  { ssr: false, loading: () => <div className="h-[250px] w-full rounded-xl bg-muted/40 animate-pulse" /> },
)
export const AdvisorProjectionChart = dynamic(
  () => import('@/components/advisor/advisor-charts').then((m) => m.AdvisorProjectionChart),
  { ssr: false, loading: () => <div className="h-[320px] w-full rounded-xl bg-muted/40 animate-pulse" /> },
)
// Their cards already fix the height (h-[400px], h-[350px]), so the placeholder fills it.
export const CompareHistoryChart = dynamic(
  () => import('@/components/compare/compare-charts').then((m) => m.CompareHistoryChart),
  { ssr: false, loading: () => <div className="h-full w-full rounded-lg bg-muted/40 animate-pulse" /> },
)
export const CompareRadarChart = dynamic(
  () => import('@/components/compare/compare-charts').then((m) => m.CompareRadarChart),
  { ssr: false, loading: () => <div className="h-full w-full rounded-lg bg-muted/40 animate-pulse" /> },
)
export const CompareReturnsChart = dynamic(
  () => import('@/components/market/compare-returns-chart').then((m) => m.CompareReturnsChart),
  { ssr: false, loading: () => <div className="h-full w-full rounded-lg bg-muted/40 animate-pulse" /> },
)
