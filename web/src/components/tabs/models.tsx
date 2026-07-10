import { lazy, Suspense, type ReactNode } from 'react'
import type { Derived } from '../../lib/derive'
import { ModelLeaderboard } from '../charts/models'

const CostByModel = lazy(() => import('../charts/breakdown').then(module => ({ default: module.CostByModel })))
const ProviderDonut = lazy(() => import('../charts/breakdown').then(module => ({ default: module.ProviderDonut })))
const CacheByModel = lazy(() => import('../charts/breakdown').then(module => ({ default: module.CacheByModel })))

function ChartBoundary({ children }: { children: ReactNode }) {
  return <Suspense fallback={<div className="min-h-64" role="status" aria-label="Loading chart" />}>{children}</Suspense>
}

export function ModelsTab({ derived, scopeLabel }: { derived: Derived; scopeLabel?: string }) {
  const multiProvider = derived.byProvider.length > 1
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <div className="md:col-span-2"><ModelLeaderboard derived={derived} periodLabel={scopeLabel} /></div>
      <div className={multiProvider ? undefined : 'md:col-span-2'}>
        <ChartBoundary><CostByModel derived={derived} metric="tokens" limit={12} periodLabel={scopeLabel} /></ChartBoundary>
      </div>
      {multiProvider ? <ChartBoundary><ProviderDonut derived={derived} periodLabel={scopeLabel} /></ChartBoundary> : null}
      <div className="md:col-span-2"><ChartBoundary><CacheByModel derived={derived} periodLabel={scopeLabel} /></ChartBoundary></div>
    </div>
  )
}
