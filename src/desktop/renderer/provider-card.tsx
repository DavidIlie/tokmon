import React, { useCallback } from 'react'
import type { Config, WebAccount, WebSnapshot } from '../../web/contract'
import { usageFromHeadroom } from '../../usage-semantics'
import { accountIdentity } from './privacy'
import { providerMark, providerMonogram } from './provider-icons'
import { ProviderUsageStats } from './provider-usage-stats'
import {
  accountQuotas,
  activeSince,
  freshness,
  isActive,
  percentText,
  planLabel,
  providerRepresentative,
  providerSecondarySummary,
  resetLabel,
  severity,
  severityTag,
  staleAgeLabel,
  usageAriaValueText,
  usageNumberText,
  type Freshness,
  type ProviderGroup,
  type ProviderRepresentative,
  type Quota,
} from './presentation'

function ProviderChip({ providerId, used, remaining, resetsAt, subject, pending, now }: {
  providerId: string; used: number | null; remaining: number | null
  resetsAt: number | null; subject: string; pending: boolean; now: number
}) {
  const level = severity(remaining)
  const mark = providerMark(providerId)
  const fill = used === null ? 0 : Math.max(0, Math.min(100, used))
  return (
    <div
      className="chip" data-sev={level} data-pending={pending || undefined}
      role="meter" aria-label={subject} aria-valuetext={usageAriaValueText(subject, used, resetsAt, now)}
      aria-valuemin={0} aria-valuemax={100}
      {...(used === null ? {} : { 'aria-valuenow': Math.round(used) })}
    >
      <span className="chip-glyph" aria-hidden="true">
        {mark
          ? <svg viewBox={mark.viewBox} preserveAspectRatio="xMidYMid meet"><path d={mark.path} fill="currentColor" fillRule={mark.fillRule ?? 'nonzero'} /></svg>
          : <span className="mark--fallback">{providerMonogram(providerId).slice(0, 2)}</span>}
      </span>
      <span className="chip-num" aria-hidden="true">{pending ? '' : usageNumberText(used)}</span>
      <span className="chip-bar" aria-hidden="true"><i style={{ width: `${fill}%` }} /></span>
    </div>
  )
}

function MeterRow({ quota, subject, dimmed, now }: { quota: Quota; subject: string; dimmed: boolean; now: number }) {
  const level = severity(quota.remaining)
  const tag = severityTag(level)
  const reset = resetLabel(quota.resetsAt, now)
  const width = quota.used === null ? 0 : Math.max(0, Math.min(100, quota.used))
  return (
    <div className={`row${dimmed ? ' is-dimmed' : ''}`} data-sev={level}>
      <div className="row-top">
        <span className="row-label">{quota.label}</span>
        <span className="row-value">
          {quota.valueText}
          {tag && <b className="sev-tag"> · {tag}</b>}
          {reset && <span className="row-reset"> · {reset}</span>}
        </span>
      </div>
      {quota.bounded && (
        <div
          className="meter" role="meter" aria-label={subject}
          aria-valuemin={0} aria-valuemax={100}
          aria-valuetext={usageAriaValueText(subject, quota.used, quota.resetsAt, now)}
          {...(quota.used === null ? {} : { 'aria-valuenow': Math.round(width) })}
        >
          <span className="meter-fill" style={{ width: `${width}%` }} />
        </div>
      )}
    </div>
  )
}

function PinToggle({ pinned, name, deny, onToggle }: {
  pinned: boolean; name: string; deny: boolean; onToggle(): void
}) {
  return (
    <button
      type="button" className="pin" data-pinned={pinned} data-deny={deny} aria-pressed={pinned}
      title={pinned ? `Unpin ${name} from the menu bar` : `Pin ${name} to the menu bar`}
      aria-label={pinned ? `Unpin ${name} from the menu bar` : `Pin ${name} to the menu bar`}
      onClick={event => { event.stopPropagation(); onToggle() }}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true" width={16} height={16} focusable="false">
        <path
          d="M5.25 1.75h5.5M6.25 1.75v3.5L4.5 7v1.25h7V7L9.75 5.25v-3.5M8 8.25v5.5"
          fill="none" stroke="currentColor" strokeWidth={1.35}
          strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke"
        />
      </svg>
    </button>
  )
}

function Chevron({ expanded }: { expanded: boolean }) {
  return (
    <span className="chevron" data-expanded={expanded} aria-hidden="true">
      <svg viewBox="0 0 16 16" width={14} height={14}>
        <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  )
}

function ActiveChip({ account, now }: { account: WebAccount; now: number }) {
  return <span className="active-chip" title={activeSince(account, now)}><i aria-hidden="true" />Active</span>
}

function ActiveBeacon({ now, account }: { now: number; account: WebAccount | null }) {
  return <span className="beacon" role="img" aria-label="Active now" title={account ? activeSince(account, now) : 'Active now'} />
}

function StaleTag({ account, now }: { account: WebAccount; now: number }) {
  return <span className="tag tag--stale" title={staleAgeLabel(account, now)}>Stale</span>
}

function ErrorMark({ message }: { message: string }) {
  return <span className="warn-mark" role="img" aria-label={`Error: ${message}`} title={message}>⚠</span>
}

function accountPending(account: WebAccount): boolean {
  return account.billingState === 'pending' && (!account.billing || account.billing.metrics.length === 0)
}

function providerPending(accounts: readonly WebAccount[]): boolean {
  return accounts.length > 0 && accounts.every(accountPending)
}

function accountErrorText(account: WebAccount): string | null {
  if (account.billingState !== 'error') return null
  return account.billing?.error ?? 'Could not refresh — check that this account is signed in.'
}

interface ProviderCardProps {
  group: ProviderGroup
  snapshot: WebSnapshot
  config: Config
  pinned: boolean
  expanded: boolean
  deny: boolean
  refreshing: boolean
  now: number
  onToggle(): void
  onPin(): void
  onArrow(direction: 'up' | 'down'): void
}

export function ProviderCard({
  group, snapshot, config, pinned, expanded, deny, refreshing, now, onToggle, onPin, onArrow,
}: ProviderCardProps) {
  const activeTimeoutMin = config.tray.activeTimeoutMin
  const rep = providerRepresentative(group.accounts, activeTimeoutMin, now)
  const headroom = snapshot.providers.find(provider => provider.id === group.providerId)?.headroom
  const multi = group.accounts.length > 1
  const pending = providerPending(group.accounts)
  const repRemaining = headroom?.value ?? rep.quota?.remaining ?? null
  const repUsed = usageFromHeadroom(repRemaining)
  const sev = severity(repRemaining)
  const sevWord = severityTag(sev)
  const reset = headroom ? null : resetLabel(rep.quota?.resetsAt ?? null, now)
  const secondary = headroom ? null : providerSecondarySummary(rep)
  const representative = headroom?.representativeAccountId
    ? group.accounts.find(account => account.id === headroom.representativeAccountId) ?? rep.account
    : rep.account
  const repFresh: Freshness = representative ? freshness(representative, snapshot, now) : 'nodata'
  const providerError = group.accounts.some(account => freshness(account, snapshot, now) === 'error')
  const providerStale = !providerError && !pending && repFresh === 'stale'
  const errorMessage = group.accounts.map(accountErrorText).find(Boolean) ?? 'Provider error'
  const headerId = `provider-header-${group.providerId}`
  const regionId = `provider-detail-${group.providerId}`
  const subject = headroom ? `${group.name} usage` : rep.quota ? `${group.name} ${rep.quota.label}` : group.name
  const valueText = headroom
    ? (repUsed === null ? (pending ? 'Loading…' : 'No data') : `Usage ${percentText(repUsed)}`)
    : rep.noData
    ? (pending ? 'Loading…' : 'No data')
    : rep.quota?.used != null ? `${percentText(rep.quota.used)} used` : 'No data'
  const identityChip = multi
    ? `${group.accounts.length} accounts`
    : (group.accounts[0] ? accountIdentity(group.accounts[0], config.privacyMode) : '')
  const providerStatusAria = providerError
    ? 'data may be outdated, could not refresh'
    : providerStale ? 'data may be outdated' : null
  const aria = headroom
    ? [group.name, valueText, multi ? `${group.accounts.length} accounts` : identityChip, providerStatusAria, expanded ? 'expanded' : 'collapsed'].filter(Boolean).join(', ')
    : buildProviderAria({ group, rep, multi, pending, sev, now, privacy: config.privacyMode, providerError, providerStale, expanded })
  const onKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); onArrow('down') }
    else if (event.key === 'ArrowUp') { event.preventDefault(); onArrow('up') }
    else if (event.key === 'ArrowRight' && !expanded) { event.preventDefault(); onToggle() }
    else if (event.key === 'ArrowLeft' && expanded) { event.preventDefault(); onToggle() }
  }, [expanded, onArrow, onToggle])

  return (
    <section className="provider" data-expanded={expanded} aria-label={group.name}>
      <div className={`provider-card${providerError ? ' is-dimmed' : ''}`}>
        <div className="provider-headrow">
          <button
            type="button" className="provider-disclosure" id={headerId}
            aria-expanded={expanded} aria-controls={regionId} aria-label={aria}
            data-sev={sev} onClick={onToggle} onKeyDown={onKeyDown}
          >
            <span className="provider-lead">
              <ProviderChip
                providerId={group.providerId} used={repUsed} remaining={repRemaining}
                resetsAt={headroom ? null : rep.quota?.resetsAt ?? null}
                subject={subject} pending={pending && rep.noData} now={now}
              />
            </span>
            <span className="provider-body">
              <span className="provider-titleline">
                <span className="provider-name">{group.name}</span>
                {group.sharedPlan && <span className="plan">{group.sharedPlan}</span>}
                {identityChip && <span className="provider-count">· {identityChip}</span>}
                {(headroom ? headroom.activeAccountIds.length > 0 : rep.providerActive) && <ActiveBeacon now={now} account={group.accounts.find(a => isActive(a, activeTimeoutMin, now)) ?? null} />}
                <span className="provider-titleline__spacer" />
                {refreshing && <span className="spinner" role="status" aria-label="Refreshing" />}
                {!refreshing && providerError && <ErrorMark message={errorMessage} />}
                {!refreshing && providerStale && representative && <StaleTag account={representative} now={now} />}
              </span>
              <span className="provider-summaryline">
                <span className="provider-value" data-sev={sev}>
                  {valueText}
                  {sevWord && <b className="sev-tag"> · {sevWord}</b>}
                </span>
                {reset && <span className="provider-reset">{reset}</span>}
              </span>
            </span>
            <Chevron expanded={expanded} />
          </button>
          <PinToggle pinned={pinned} name={group.name} deny={deny} onToggle={onPin} />
        </div>

        <div className="provider-detail-wrap" data-expanded={expanded}>
          <div id={regionId} role="region" aria-labelledby={headerId} className="provider-detail">
            {expanded && (
              <ProviderUsageStats
                accounts={group.accounts} providerName={group.name}
                intervalMs={snapshot.intervalMs} rangeDays={config.desktop.graphRangeDays} now={now}
              />
            )}
            {expanded && secondary && <p className="provider-secondary" title="Measured provider windows.">{secondary}</p>}
            {expanded && group.accounts.map((account, index) => (
              <ExpandedAccount
                key={account.id} account={account} snapshot={snapshot} config={config}
                providerName={group.name} showPlan={group.sharedPlan === null} first={index === 0}
                activeTimeoutMin={activeTimeoutMin} now={now}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

function ExpandedAccount({ account, snapshot, config, providerName, showPlan, first, activeTimeoutMin, now }: {
  account: WebAccount; snapshot: WebSnapshot; config: Config; providerName: string
  showPlan: boolean; first: boolean; activeTimeoutMin: number; now: number
}) {
  const fresh = freshness(account, snapshot, now)
  const active = isActive(account, activeTimeoutMin, now)
  const pending = accountPending(account)
  const quotas = accountQuotas(account)
  const plan = planLabel(account.plan)
  const identity = accountIdentity(account, config.privacyMode)
  const errorText = accountErrorText(account)
  return (
    <div className="account-block">
      {!first && <div className="divider" />}
      <div className="account-line">
        <span className="account-identity">{identity}</span>
        {showPlan && plan && <span className="plan">{plan}</span>}
        {fresh === 'error' && <ErrorMark message={errorText ?? 'Provider error'} />}
        {fresh === 'stale' && <StaleTag account={account} now={now} />}
        {active && <ActiveChip account={account} now={now} />}
      </div>
      {errorText && <p className="account-error">{errorText}</p>}
      <div className={`rows${fresh === 'error' ? ' is-dimmed' : ''}`}>
        {quotas.length > 0
          ? quotas.map(quota => (
            <MeterRow key={quota.key} quota={quota} subject={`${providerName} ${identity} ${quota.label}`} dimmed={fresh === 'error'} now={now} />
          ))
          : (
            <div className="row row--nodata">
              <span className="row-label">{pending ? 'Loading…' : 'No data'}</span>
              <span className="row-value">{pending ? '' : '—'}</span>
            </div>
          )}
      </div>
    </div>
  )
}

function buildProviderAria({ group, rep, multi, pending, sev, now, privacy, providerError, providerStale, expanded }: {
  group: ProviderGroup; rep: ProviderRepresentative; multi: boolean; pending: boolean
  sev: ReturnType<typeof severity>; now: number; privacy: boolean; providerError: boolean; providerStale: boolean; expanded: boolean
}): string {
  const parts: string[] = [group.name]
  if (group.sharedPlan) parts.push(group.sharedPlan)
  if (multi) parts.push(`${group.accounts.length} accounts`)
  if (rep.noData) parts.push(pending ? 'loading' : 'no usage data')
  else if (rep.quota) {
    if (rep.quota.used !== null) parts.push(`${percentText(rep.quota.used)} used`)
    if (multi && rep.account) parts.push(`via ${accountIdentity(rep.account, privacy)}`)
    const word = severityTag(sev)
    if (word) parts.push(word.toLowerCase())
    const reset = resetLabel(rep.quota.resetsAt, now)
    if (reset) parts.push(reset.toLowerCase())
  }
  if (providerError) parts.push('data may be outdated, could not refresh')
  else if (providerStale) parts.push('data may be outdated')
  parts.push(expanded ? 'expanded' : 'collapsed')
  return parts.join(', ')
}
