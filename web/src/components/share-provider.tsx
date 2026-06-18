import { createContext, useContext, useState, type ReactNode } from 'react'
import type { Derived } from '../lib/derive'
import { ShareSheet } from './share-sheet'

export type ShareSource =
  | { kind: 'summary'; derived: Derived; periodLabel: string; tz: string; version: string }
  | { kind: 'panel'; node: HTMLElement; captureName: string }

const ShareCtx = createContext<(s: ShareSource) => void>(() => {})
export const useShare = () => useContext(ShareCtx)

export function ShareProvider({ children }: { children: ReactNode }) {
  const [source, setSource] = useState<ShareSource | null>(null)
  return (
    <ShareCtx.Provider value={setSource}>
      {children}
      {source && <ShareSheet source={source} onClose={() => setSource(null)} />}
    </ShareCtx.Provider>
  )
}
