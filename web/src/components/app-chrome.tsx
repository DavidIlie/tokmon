import { useEffect, useState } from 'react'
import type { WebSnapshot } from '@shared'
import { fmtAgo, fmtResetAt } from '../lib/format'
import type { ConnState } from '../lib/use-snapshot'
import { Moon, Refresh, Settings, Sun } from './icons'
import { FOCUS_RING } from './ui/primitives'

export type RefreshPhase = 'idle' | 'refreshing' | 'success' | 'error'

function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

export function ThemeToggle({ mode, resolvedMode, disabled, onToggle }: {
  mode: 'auto' | 'dark' | 'light'
  resolvedMode: 'dark' | 'light'
  disabled?: boolean
  onToggle: () => void
}) {
  const next = mode === 'auto' ? 'light' : mode === 'light' ? 'dark' : 'auto'
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      title={`Theme: ${mode}${mode === 'auto' ? ` (${resolvedMode})` : ''}. Switch to ${next}`}
      aria-label={`Theme mode ${mode}${mode === 'auto' ? `, currently ${resolvedMode}` : ''}; switch to ${next}`}
      className={`relative rounded border border-line bg-bg-1 p-1.5 text-fg-dim transition hover:border-line-2 hover:text-fg disabled:opacity-40 max-sm:p-2.5 ${FOCUS_RING}`}
    >
      {resolvedMode === 'dark' ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
      {mode === 'auto' && <span className="absolute -right-1 -top-1 text-[8px] font-bold text-accent" aria-hidden>A</span>}
    </button>
  )
}

export function ConnDot({ conn, freshAt }: { conn: ConnState; freshAt: number | null }) {
  const now = useNow()
  const color = conn === 'live' ? 'var(--color-ok)' : conn === 'error' ? 'var(--color-critical)' : 'var(--color-warning)'
  const age = freshAt ? fmtAgo(freshAt, now) : null
  const label = conn === 'live' ? (age ?? 'live')
    : conn === 'connecting' ? 'connecting…'
    : conn === 'reconnecting' ? (age ? `reconnecting · ${age}` : 'reconnecting…')
    : (age ? `offline · ${age}` : 'offline')
  return (
    <span className="flex items-center gap-1.5 text-xs" role="status" aria-live="polite">
      <span className="relative flex size-2" aria-hidden>
        {conn === 'live' && <span className="absolute inline-flex size-full animate-ping rounded-full opacity-60" style={{ background: color }} />}
        <span className="relative inline-flex size-2 rounded-full" style={{ background: color }} />
      </span>
      <span className="inline-block truncate text-fg-dim max-sm:max-w-[7rem]">{label}</span>
    </span>
  )
}

export function Connecting({ label }: { label: string }) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-2 text-sm text-fg-dim" role="status" aria-live="polite">
      <span className="font-display text-lg text-fg-dim" aria-hidden>tokmon<span className="cursor-blink text-accent">▋</span></span>
      <span className="text-fg-faint">{label}</span>
    </div>
  )
}

export function connectionMessage(conn: ConnState, fallback: string): string {
  if (conn === 'error' || conn === 'reconnecting') return 'Connection lost — waiting for the local tokmon daemon…'
  return fallback
}

export function focusDashboard(): void {
  const target = document.getElementById('dashboard-content')
  if (!target) return
  target.scrollIntoView({ block: 'start' })
  requestAnimationFrame(() => target.focus({ preventScroll: true }))
}

export function SettingsButton({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      title="Settings"
      aria-label="Open settings"
      className={`rounded border border-line bg-bg-1 p-1.5 text-fg-dim transition hover:border-line-2 hover:text-fg max-sm:p-2.5 ${FOCUS_RING}`}
    >
      <Settings className="size-3.5" />
    </button>
  )
}

export function RefreshButton({ phase, onRefresh }: { phase: RefreshPhase; onRefresh: () => void }) {
  const label = phase === 'refreshing' ? 'refreshing…'
    : phase === 'success' ? 'updated'
    : phase === 'error' ? 'refresh failed'
    : 'refresh'
  return (
    <button
      type="button"
      onClick={onRefresh}
      disabled={phase === 'refreshing'}
      title="Refresh all data (R)"
      aria-label="Refresh all data"
      className={`flex items-center gap-1.5 rounded border border-line bg-bg-1 px-2 py-1.5 text-xs text-fg-dim transition hover:border-line-2 hover:text-fg disabled:cursor-wait ${FOCUS_RING}`}
    >
      <Refresh className={`size-3.5 ${phase === 'refreshing' ? 'animate-spin motion-reduce:animate-none' : ''}`} />
      <span className={phase === 'error' ? 'text-critical' : ''}>{label}</span>
    </button>
  )
}

export function PeakStatusBadge({ peak, resetDisplay, tz }: {
  peak: NonNullable<WebSnapshot['peak']>
  resetDisplay: 'relative' | 'absolute'
  tz: string
}) {
  const color = peak.state === 'peak' ? 'var(--color-warning)' : 'var(--color-positive)'
  const changesAt = peak.changesAt ?? (peak.minutesUntilChange != null
    ? new Date(Date.now() + peak.minutesUntilChange * 60_000).toISOString()
    : null)
  return (
    <span className="hidden items-center gap-1 text-xs text-fg-dim lg:flex">
      <span aria-hidden style={{ color }}>●</span>
      <span style={{ color }}>{peak.label}</span>
      {changesAt && <span className="tnum text-fg-faint">({fmtResetAt(changesAt, resetDisplay, Date.now(), tz)})</span>}
    </span>
  )
}
