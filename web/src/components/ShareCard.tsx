import type { Derived } from '../lib/derive'
import { Share } from './icons'
import { useShare } from './ShareProvider'

// Header Share button — opens the shared ShareSheet with the curated summary card.
export function ShareControl({ derived, periodLabel, tz, version }: {
  derived: Derived
  periodLabel: string
  tz: string
  version: string
}) {
  const openShare = useShare()
  return (
    <button
      onClick={() => openShare({ kind: 'summary', derived, periodLabel, tz, version })}
      className="flex items-center gap-1.5 rounded border border-line bg-bg-1 px-2.5 py-1 text-xs text-fg-dim transition hover:border-accent/60 hover:text-accent active:scale-[0.97] max-sm:py-2"
      title="Create a shareable image"
    >
      <Share className="size-3.5" /><span>share</span>
    </button>
  )
}
