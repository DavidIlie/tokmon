import { lazy, Suspense, type ReactNode } from 'react'
import type { Derived } from '../../lib/derive'
import { CalendarHeatmap } from '../charts/calendar'

const CostByModel = lazy(() => import('../charts/breakdown').then(module => ({ default: module.CostByModel })))
const ProviderDonut = lazy(() => import('../charts/breakdown').then(module => ({ default: module.ProviderDonut })))
const TokenComposition = lazy(() => import('../charts/breakdown').then(module => ({ default: module.TokenComposition })))
const CacheSavings = lazy(() => import('../charts/timeline').then(module => ({ default: module.CacheSavings })))
const CumulativeSpend = lazy(() => import('../charts/timeline').then(module => ({ default: module.CumulativeSpend })))

function ChartBoundary({ children }: { children: ReactNode }) {
  return <Suspense fallback={<div className="min-h-64" role="status" aria-label="Loading chart" />}>{children}</Suspense>
}

export function AnalyticsTab({ derived, scopeLabel }: { derived: Derived; scopeLabel?: string }) {
  const multiProvider = derived.byProvider.length > 1
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <div className="md:col-span-2"><CalendarHeatmap derived={derived} periodLabel={scopeLabel} /></div>
      <ChartBoundary><CostByModel derived={derived} periodLabel={scopeLabel} /></ChartBoundary>
      <ChartBoundary>{multiProvider ? <ProviderDonut derived={derived} periodLabel={scopeLabel} /> : <TokenComposition derived={derived} periodLabel={scopeLabel} />}</ChartBoundary>
      {multiProvider ? <ChartBoundary><TokenComposition derived={derived} periodLabel={scopeLabel} /></ChartBoundary> : null}
      <div className={multiProvider ? undefined : 'md:col-span-2'}><ChartBoundary><CacheSavings derived={derived} periodLabel={scopeLabel} /></ChartBoundary></div>
      <div className="md:col-span-2"><ChartBoundary><CumulativeSpend derived={derived} height={300} periodLabel={scopeLabel} /></ChartBoundary></div>
    </div>
  )
}
