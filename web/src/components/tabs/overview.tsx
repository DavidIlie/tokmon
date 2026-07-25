import { lazy, Suspense } from 'react'
import type { WebProviderInfo } from '@shared'
import type { Derived } from '../../lib/derive'
import { KpiStrip, ProviderCards } from '../charts/cards'

const CostTimeline = lazy(() => import('../charts/timeline').then(module => ({ default: module.CostTimeline })))

export function OverviewTab({ derived, periodLabel, scopeLabel, providers, privacyMode, ordinals, resetDisplay, tz }: {
  derived: Derived
  periodLabel: string
  scopeLabel?: string
  providers: WebProviderInfo[]
  privacyMode: boolean
  ordinals?: ReadonlyMap<string, number>
  resetDisplay: 'relative' | 'absolute'
  tz: string
}) {
  const names = new Map<string, string>(providers.map(provider => [provider.id, provider.name]))
  const nameOf = (id: string) => names.get(id) ?? id

  return (
    <div className="flex flex-col gap-4">
      <KpiStrip derived={derived} periodLabel={periodLabel} />
      <Suspense fallback={<div className="h-[clamp(320px,42vh,560px)]" role="status" aria-label="Loading cost timeline" />}>
        <CostTimeline derived={derived} periodLabel={scopeLabel} heightClass="h-[clamp(320px,42vh,560px)]" />
      </Suspense>
      <ProviderCards accounts={derived.cardAccounts} nameOf={nameOf} privacyMode={privacyMode} ordinals={ordinals} resetDisplay={resetDisplay} tz={tz} />
    </div>
  )
}
