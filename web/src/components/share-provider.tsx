import { createContext, lazy, Suspense, useContext, useState, type ReactNode } from 'react'
import type { Derived } from '../lib/derive'
import type { ModelSpotlightData } from '../lib/derive.explore'

const ShareSheet = lazy(() => import('./share-sheet').then(module => ({ default: module.ShareSheet })))

export type ShareSource =
  | { kind: 'summary'; derived: Derived; periodLabel: string; tz: string; version: string }
  | { kind: 'panel'; node: HTMLElement; captureName: string }
  | ({ kind: 'model'; model: string; periodLabel: string; tz: string; version: string } & ModelSpotlightData)

const ShareCtx = createContext<((source: ShareSource) => void) | null>(null)
export const useShare = () => {
  const openShare = useContext(ShareCtx)
  if (!openShare) throw new Error('useShare must be used inside ShareProvider')
  return openShare
}

export function ShareProvider({ children }: { children: ReactNode }) {
  const [source, setSource] = useState<ShareSource | null>(null)
  return (
    <ShareCtx.Provider value={setSource}>
      {children}
      {source ? (
        <Suspense fallback={<div className="fixed inset-0 z-[60] grid place-items-center bg-bg-0/70 text-sm text-fg-dim" role="status" aria-live="polite">Preparing share preview…</div>}>
          <ShareSheet source={source} onClose={() => setSource(null)} />
        </Suspense>
      ) : null}
    </ShareCtx.Provider>
  )
}
