// React stays in scope: the root test runner transpiles this file with the classic JSX runtime.
import React from 'react'
import type { WebSnapshot } from '../../web/contract'
import { formatAgo } from '../../shared/format'
import type { DesktopState, DesktopUpdateState } from '../shared/desktop-contract'
import { daemonLabel, snapshotUsageTotals, totalsCopy, usageDataStatus } from '../shared/presentation'

function updatedLabel(snapshot: WebSnapshot | null, now: number): string {
  if (!snapshot) return 'Waiting…'
  return `Updated ${formatAgo(snapshot.generatedAt, now)}`
}

function SettingsIcon() {
  return <svg viewBox="0 0 16 16" width={16} height={16} aria-hidden="true"><path d="M6.8 1.5h2.4l.35 1.45c.35.12.68.26.98.45l1.28-.77 1.7 1.7-.77 1.28c.19.3.33.63.45.98L14.5 7v2l-1.31.4c-.12.35-.26.68-.45.98l.77 1.28-1.7 1.7-1.28-.77c-.3.19-.63.33-.98.45L9.2 14.5H6.8l-.35-1.46a5 5 0 0 1-.98-.45l-1.28.77-1.7-1.7.77-1.28a5 5 0 0 1-.45-.98L1.5 9V7l1.31-.4c.12-.35.26-.68.45-.98l-.77-1.28 1.7-1.7 1.28.77c.3-.19.63-.33.98-.45L6.8 1.5Z" fill="none" stroke="currentColor" strokeWidth="1.15" strokeLinejoin="round"/><circle cx="8" cy="8" r="2" fill="none" stroke="currentColor" strokeWidth="1.15"/></svg>
}

export function Footer({ snapshot, refreshing, now, appName, appVersion, daemon, onRefresh, onSettings, onDashboard }: {
  snapshot: WebSnapshot | null; refreshing: boolean; now: number
  appName: string; appVersion: string; daemon: DesktopState['daemon']
  onRefresh(): void; onSettings(): void; onDashboard(): void
}) {
  const freshness = refreshing ? 'Refreshing…' : updatedLabel(snapshot, now)
  const service = daemonLabel(daemon)
  return (
    <footer className="footer">
      <div className="footer-status">
        <button
          type="button" className="footer-refresh" title="Refresh now (⌘R)"
          aria-label={`${freshness}. Refresh now`} onClick={onRefresh}
        >
          {freshness}
        </button>
        {appVersion && (
          <span
            className="footer-app"
            title={`Version ${appVersion}${service ? ` · ${service}` : ''}`}
            aria-label={`${appName} version ${appVersion}${service ? `, ${service}` : ''}`}
          >
            <span aria-hidden="true">{appName} {appVersion}{daemon?.role === 'attached' ? ' · CLI service' : ''}</span>
          </span>
        )}
      </div>
      <span className="footer-actions">
        <button type="button" className="footer-settings" title="Desktop settings (⌘,)" aria-label="Desktop settings" onClick={onSettings}><SettingsIcon /></button>
        <button type="button" className="footer-dashboard" onClick={onDashboard}>Open Dashboard</button>
      </span>
    </footer>
  )
}

export function TotalsBar({ snapshot, now }: { snapshot: WebSnapshot; now: number }) {
  const totals = snapshotUsageTotals(snapshot)
  if (!totals) return null
  const status = usageDataStatus(totals.accounts, snapshot.intervalMs, now)
  if (!totals.dashboard) {
    return (
      <aside className="totals" data-state="loading" role="status" aria-label="Cross-provider usage totals are loading">
        <span className="totals-primary">Usage totals</span>
        <span className="totals-secondary">Reading usage…</span>
      </aside>
    )
  }
  const copy = totalsCopy(totals.dashboard)
  const detail = status ? `${copy.title}; ${status}` : copy.title
  const warning = status?.startsWith('Partial') ? 'Partial' : status ? 'Stale' : null
  const state = warning?.toLowerCase() ?? 'ready'
  return (
    <aside className="totals" data-state={state} title={detail} aria-label={`${copy.ariaLabel}${status ? ` ${status}.` : ''}`}>
      <span className="totals-primary">{copy.primary}</span>
      {warning && <span className="totals-warning" aria-hidden="true">{warning}</span>}
      <span className="totals-secondary">{copy.secondary}</span>
    </aside>
  )
}

export function UpdateReady({ update, currentVersion, onInstall, onCheck = () => {}, onDownload = () => {} }: {
  update: DesktopUpdateState; currentVersion: string; onInstall(): void; onCheck?(): void; onDownload?(): void
}) {
  if (update.status === 'error') {
    return (
      <aside className="update-ready" data-state="error" role="alert">
        <span className="update-copy">
          <strong>Update couldn’t finish</strong>
          <small>{update.error ?? 'Check for updates again to retry.'}</small>
        </span>
        <span className="update-actions">
          <button type="button" onClick={onCheck}>Check Again</button>
          <button type="button" className="update-download" onClick={onDownload}>Download Latest</button>
        </span>
      </aside>
    )
  }
  if (!['available', 'downloading', 'downloaded', 'restarting'].includes(update.status) || !update.availableVersion) return null
  const progress = update.progressPercent === null ? null : Math.round(update.progressPercent)
  const content = update.status === 'available'
    ? { title: `Preparing Tokmon ${update.availableVersion}…`, detail: 'Starting download' }
    : update.status === 'downloading'
      ? { title: `Downloading Tokmon ${update.availableVersion}…`, detail: progress === null ? 'Downloading…' : `${progress}%` }
      : update.status === 'restarting'
        ? { title: `Restarting to install Tokmon ${update.availableVersion}…`, detail: 'Closing the background service safely' }
        : { title: `Tokmon ${update.availableVersion} is ready`, detail: `Current version ${currentVersion}` }
  return (
    <aside className="update-ready" data-state={update.status} role="status" aria-live="polite" aria-label={`${content.title} ${content.detail}`}>
      <span className="update-copy">
        <strong>{content.title}</strong>
        <small>{content.detail}</small>
      </span>
      {update.status === 'downloaded' && <button type="button" onClick={onInstall}>Restart to Install</button>}
      {(update.status === 'available' || update.status === 'downloading') && (
        <span className="update-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress ?? undefined}>
          <span style={{ width: `${progress ?? 4}%` }} />
        </span>
      )}
    </aside>
  )
}

export function ColdState({ state }: { state: DesktopState | null }) {
  const failed = state?.connection === 'error'
  const reconnecting = state?.connection === 'reconnecting'
  return (
    <section className="cold" aria-live="polite">
      <strong>{failed ? 'Background service unavailable' : reconnecting ? 'Reconnecting…' : 'Connecting to Tokmon…'}</strong>
      {failed && <span>{state?.error ?? 'Tokmon could not start its background service.'}</span>}
      {(failed || reconnecting) && (
        <button type="button" className="cold-retry" onClick={() => void window.tokmon.retryConnection()}>Retry</button>
      )}
    </section>
  )
}

export function EmptyState({ onDashboard }: { onDashboard(): void }) {
  return (
    <section className="cold">
      <strong>No accounts configured.</strong>
      <button type="button" className="cold-retry" onClick={onDashboard}>Open Dashboard</button>
    </section>
  )
}
