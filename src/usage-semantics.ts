import type { Metric } from './providers/types'
export type MetricRole = 'session' | 'weekly' | 'model' | 'other' | 'unbounded'

export type QuotaValue = {
  kind: 'money'
  used: number
  limit: number | null
  remaining: number | null
  currency: string
}

export interface QuotaView {
  key: string
  label: string
  role: MetricRole
  modelId: string | null
  usedPct: number | null
  remainingPct: number | null
  resetsAt: number | null
  bounded: boolean
  primary: boolean
  active: boolean
  displayOrder: number
  valueText: string
  /** Authoritative provider amount retained alongside the percentage meter. */
  value?: QuotaValue
}

export interface AccountIdentityView {
  title: string
  subtitle: string | null
  accessibleLabel: string
  redacted: boolean
}

export interface HeadroomFactor {
  key: string
  label: string
  role: MetricRole
  remainingPct: number
  included: boolean
  reason: 'session' | 'active-model' | 'weekly-cap' | 'primary' | 'fallback-floor'
}

export interface HeadroomView {
  value: number | null
  unit: 'index-100'
  mode: 'smart' | 'single-window' | 'fallback-floor' | 'unavailable'
  basis: 'active' | 'idle-runway' | 'unavailable'
  representativeAccountId: string | null
  activeAccountIds: string[]
  factors: HeadroomFactor[]
  explanation: string
}

export interface HeadroomAccountInput {
  id: string
  lastActivityAt: number | null
  quotas: readonly QuotaView[]
}

const clampPct = (value: number): number => Math.max(0, Math.min(100, value))

function inferRole(metric: Metric): MetricRole {
  if (metric.role) return metric.role
  if (metric.format.kind !== 'percent' && !(metric.limit != null && metric.limit > 0)) return 'unbounded'
  const label = metric.label.trim().toLowerCase()
  if (label === 'session' || label.includes('five hour')) return 'session'
  if (label === 'weekly' || label.includes('seven day') || label.includes('weekly all')) return 'weekly'
  if (metric.modelId || (!metric.primary && metric.format.kind === 'percent' && !['usage', 'api', 'auto'].includes(label))) return 'model'
  return 'other'
}

function formatMoney(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(value)
  } catch { return `$${value.toFixed(2)}` }
}

function moneyValue(metric: Metric): QuotaValue | undefined {
  if (metric.format.kind !== 'dollars' || !Number.isFinite(metric.used)) return undefined
  const limit = metric.limit != null && Number.isFinite(metric.limit) ? metric.limit : null
  return {
    kind: 'money',
    used: metric.used,
    limit,
    remaining: limit === null ? null : limit - metric.used,
    currency: metric.format.currency?.trim().toUpperCase() || 'USD',
  }
}

function valueText(metric: Metric, usedPct: number | null, value?: QuotaValue): string {
  if (value) {
    if (value.remaining === null) return formatMoney(value.used, value.currency)
    const used = `${formatMoney(value.used, value.currency)} used`
    return value.remaining >= 0
      ? `${used} · ${formatMoney(value.remaining, value.currency)} left`
      : `${used} · ${formatMoney(-value.remaining, value.currency)} over`
  }
  if (usedPct !== null) return `${Math.round(usedPct)}% used`
  if (!Number.isFinite(metric.used)) return '—'
  if (metric.format.kind === 'dollars') {
    return formatMoney(metric.used, metric.format.currency?.trim().toUpperCase() || 'USD')
  }
  if (metric.format.kind === 'count') {
    const suffix = metric.format.suffix?.trim()
    return `${Math.round(metric.used).toLocaleString('en-US')}${suffix ? ` ${suffix}` : ''}`
  }
  return `${Math.round(metric.used)}% used`
}

const roleOrder = (role: MetricRole): number => role === 'session' ? 0 : role === 'weekly' ? 1 : role === 'model' ? 2 : role === 'other' ? 3 : 4

/** Normalize one provider metric into the canonical wire/display contract. */
export function deriveQuotaView(metric: Metric, sourceIndex = 0): QuotaView {
  const bounded = metric.format.kind === 'percent' || (metric.limit != null && Number.isFinite(metric.limit) && metric.limit > 0)
  const usedPct = metric.format.kind === 'percent' ? metric.used : metric.limit != null && metric.limit > 0 ? metric.used / metric.limit * 100 : null
  const finiteUsedPct = usedPct == null || !Number.isFinite(usedPct) ? null : clampPct(usedPct)
  const resets = metric.resetsAt ? Date.parse(metric.resetsAt) : Number.NaN
  const value = moneyValue(metric)
  return {
    key: metric.key ?? `${metric.label}:${sourceIndex}`,
    label: metric.label.replace(/\s*(limit|usage)$/i, '').trim() || metric.label,
    role: inferRole(metric),
    modelId: metric.modelId ?? null,
    usedPct: finiteUsedPct,
    remainingPct: bounded && finiteUsedPct != null ? clampPct(100 - finiteUsedPct) : null,
    resetsAt: Number.isFinite(resets) ? resets : null,
    bounded,
    primary: metric.primary === true,
    active: metric.active === true,
    displayOrder: sourceIndex,
    valueText: valueText(metric, finiteUsedPct, value),
    ...(value ? { value } : {}),
  }
}

/** Normalize provider metrics once into canonical cross-surface display rows. */
export function deriveQuotaViews(metrics: readonly Metric[]): QuotaView[] {
  return metrics.map(deriveQuotaView).sort((a, b) => roleOrder(a.role) - roleOrder(b.role)
    || (a.role === 'model' ? a.label.localeCompare(b.label) : a.displayOrder - b.displayOrder)
    || a.key.localeCompare(b.key))
    .map((quota, displayOrder) => ({ ...quota, displayOrder }))
}

/**
 * Prefer daemon-normalized quota rows. Raw metrics are a compatibility input for
 * cached snapshots produced before the canonical quota contract existed.
 */
export function resolveQuotaViews(input: {
  quotas?: readonly QuotaView[] | null
  metrics?: readonly Metric[] | null
}): QuotaView[] {
  return input.quotas == null ? deriveQuotaViews(input.metrics ?? []) : [...input.quotas]
}

/** Convert the daemon's availability-oriented score into the user-facing usage direction. */
export function usageFromHeadroom(value: number | null): number | null {
  return value === null || !Number.isFinite(value) ? null : clampPct(100 - value)
}

// ── Severity ─────────────────────────────────────────────────────────────────
// The one availability band shared by every surface's colour/tone. Input is
// percent *remaining* (0–100): ≤10 critical, ≤25 warning, else ok. Visible copy
// stays usage-oriented (low remaining ⇒ High / Very high usage). Keeping this in
// one place means a threshold change is a single edit, not five inlined chains.
export type Severity = 'unknown' | 'ok' | 'warn' | 'crit'

export function severity(remaining: number | null): Severity {
  if (remaining === null || !Number.isFinite(remaining)) return 'unknown'
  if (remaining <= 10) return 'crit'
  if (remaining <= 25) return 'warn'
  return 'ok'
}

/** The mandatory text companion to colour: never carry severity by colour alone. */
export function severityTag(level: Severity): string | null {
  if (level === 'warn') return 'High'
  if (level === 'crit') return 'Very high'
  return null
}

/** Registered account title first; privacy mode always becomes a stable provider ordinal. */
export function deriveAccountIdentity(input: {
  name: string
  email?: string | null
  displayName?: string | null
  providerName: string
  ordinal: number
  privacyMode: boolean
}): AccountIdentityView {
  const registered = input.name.trim() || input.providerName
  const email = input.email?.trim() || null
  const displayName = input.displayName?.trim() || null
  if (input.privacyMode) {
    const title = `${input.providerName} account ${input.ordinal}`
    return { title, subtitle: null, accessibleLabel: title, redacted: true }
  }
  const title = registered
  const subtitleCandidate = email && !registered.toLowerCase().includes(email.toLowerCase()) ? email : displayName
  const subtitle = subtitleCandidate && subtitleCandidate !== title ? subtitleCandidate : null
  // Privacy mode returned above, so this path is always the unredacted title.
  return { title, subtitle, accessibleLabel: subtitle ? `${title}, ${subtitle}` : title, redacted: false }
}

export interface AccountIdentityInput {
  identity?: AccountIdentityView | null
  name?: string | null
}

/**
 * The canonical account display label (no provider prefix): title, then
 * subtitle, from the daemon's privacy-aware identity — de-duplicated and with
 * the provider name filtered out so it never reads "Claude · Claude". Older or
 * cached snapshots without a resolved identity fall back to the registered name.
 * Single source shared by the web dashboard and the TUI. The desktop menu-bar
 * deliberately uses an email-first identity instead (see
 * src/desktop/shared/privacy.ts) — that divergence is intentional, not drift.
 */
export function accountIdentityText(account: AccountIdentityInput, providerName: string): string {
  const identity = account.identity
  if (!identity) return account.name || providerName
  const parts = [identity.title, identity.subtitle]
    .filter((value): value is string => !!value?.trim())
    .filter((value, index, values) => values.indexOf(value) === index)
    .filter(value => value.toLocaleLowerCase() !== providerName.toLocaleLowerCase())
  return parts.join(' · ') || identity.title || providerName
}

/**
 * The one privacy projection every account surface must agree on.
 *
 * Privacy is baked into the daemon snapshot, so a client whose local draft has
 * privacy on can be holding an identity resolved while it was off. In privacy
 * mode this therefore never trusts a `redacted: false` identity and falls back
 * to a locally recomputed provider ordinal — the same ordinal assembleSnapshot
 * assigns, which is why callers pass position within `providerId`. A row with
 * no resolved account behind it (a removed one) passes `null` and is named
 * without a number, rather than borrowing one that already names a live
 * account.
 *
 * With privacy off it returns `visible` untouched: each surface keeps its own
 * visible identity (billing-first in the TUI, title · subtitle on the web,
 * accessible label on the desktop), and privacy mode is what discards them.
 */
export function projectAccountIdentity(input: {
  identity?: AccountIdentityView | null
  visible: string
  providerName: string
  ordinal: number | null
  privacyMode: boolean
}): string {
  if (!input.privacyMode) return input.visible
  if (input.identity?.redacted) return input.identity.accessibleLabel
  return input.ordinal === null
    ? `${input.providerName} account`
    : `${input.providerName} account ${input.ordinal}`
}

/** 1-based position within each provider, matching assembleSnapshot's ordinals. */
export function accountProviderOrdinals(
  accounts: readonly { id: string; providerId: string }[],
): Map<string, number> {
  const perProvider = new Map<string, number>()
  const ordinals = new Map<string, number>()
  for (const account of accounts) {
    const ordinal = (perProvider.get(account.providerId) ?? 0) + 1
    perProvider.set(account.providerId, ordinal)
    ordinals.set(account.id, ordinal)
  }
  return ordinals
}

/** Conservative two-window composite: never exceeds the tighter real window. */
export function blendHeadroom(a: number, b: number): number {
  const low = Math.min(clampPct(a), clampPct(b))
  const high = Math.max(clampPct(a), clampPct(b))
  return low * (0.9 + 0.1 * high / 100)
}

/** The canonical tightest bounded quota; used by daemon, CLI adapters, and desktop. */
export function tightestQuotaView(quotas: readonly QuotaView[]): QuotaView | null {
  return quotas.filter(q => q.remainingPct !== null).sort((a, b) => a.remainingPct! - b.remainingPct! || (a.resetsAt ?? Infinity) - (b.resetsAt ?? Infinity) || a.key.localeCompare(b.key))[0] ?? null
}

function accountHeadroom(account: HeadroomAccountInput): Omit<HeadroomView, 'basis' | 'representativeAccountId' | 'activeAccountIds'> {
  const session = account.quotas.find(q => q.role === 'session' && q.remainingPct !== null)
  const models = account.quotas.filter(q => q.role === 'model' && q.remainingPct !== null)
  const activeModel = models.find(q => q.active) ?? null
  const weekly = account.quotas.find(q => q.role === 'weekly' && q.remainingPct !== null)
  const factors: HeadroomFactor[] = []
  let value: number | null = null
  let mode: HeadroomView['mode'] = 'unavailable'
  if (session && activeModel) {
    value = blendHeadroom(session.remainingPct!, activeModel.remainingPct!)
    mode = 'smart'
    factors.push(
      { key: session.key, label: session.label, role: session.role, remainingPct: session.remainingPct!, included: true, reason: 'session' },
      { key: activeModel.key, label: activeModel.label, role: activeModel.role, remainingPct: activeModel.remainingPct!, included: true, reason: 'active-model' },
    )
  } else if (session || activeModel) {
    const only = session ?? activeModel!
    value = only.remainingPct!
    mode = 'single-window'
    factors.push({ key: only.key, label: only.label, role: only.role, remainingPct: only.remainingPct!, included: true, reason: session ? 'session' : 'active-model' })
  } else {
    const primary = account.quotas.find(q => q.primary && q.remainingPct !== null) ?? null
    if (primary) {
      value = primary.remainingPct
      mode = 'single-window'
      factors.push({ key: primary.key, label: primary.label, role: primary.role, remainingPct: primary.remainingPct!, included: true, reason: 'primary' })
    } else {
      const floor = tightestQuotaView(account.quotas)
      if (floor) {
        value = floor.remainingPct
        mode = 'fallback-floor'
        factors.push({ key: floor.key, label: floor.label, role: floor.role, remainingPct: floor.remainingPct!, included: true, reason: 'fallback-floor' })
      }
    }
  }
  if (value !== null && weekly) {
    const close = weekly.remainingPct! <= 30 || weekly.remainingPct! <= value + 10
    value = Math.min(value, weekly.remainingPct!)
    factors.push({ key: weekly.key, label: weekly.label, role: weekly.role, remainingPct: weekly.remainingPct!, included: close, reason: 'weekly-cap' })
  }
  const included = factors.filter(f => f.included)
  return {
    value,
    unit: 'index-100',
    mode,
    factors,
    explanation: value === null ? 'No bounded quota data' : `Based on ${included.map(f => f.label).join(' + ') || 'available quota data'}`,
  }
}

/**
 * Pool equal account capacity per canonical quota before applying the smart
 * Session + active model + Weekly formula. A missing quota is unknown rather
 * than free capacity, so only accounts reporting that quota enter its mean.
 */
function cumulativeQuotaViews(accounts: readonly HeadroomAccountInput[]): QuotaView[] {
  const groups = new Map<string, QuotaView[]>()
  for (const account of accounts) {
    for (const quota of account.quotas) {
      if (quota.remainingPct === null) continue
      const identity = quota.role === 'session' || quota.role === 'weekly'
        ? quota.role
        : quota.role === 'model'
          ? `${quota.role}:${quota.modelId ?? quota.label.toLowerCase()}`
          : `${quota.role}:${quota.key}`
      const rows = groups.get(identity) ?? []
      rows.push(quota)
      groups.set(identity, rows)
    }
  }
  return [...groups.values()]
    // A model-scoped quota reported by only one of several accounts describes
    // that account, not the provider's pooled capacity. It remains visible in
    // the account drill-down but cannot make the provider headline read 100%.
    .filter(rows => rows[0]!.role !== 'model' || rows.length > 1 || accounts.length === 1)
    .map(rows => {
    const first = rows[0]!
    const remainingPct = rows.reduce((sum, quota) => sum + quota.remainingPct!, 0) / rows.length
    const usedPct = 100 - remainingPct
    const resets = rows.map(quota => quota.resetsAt).filter((value): value is number => value !== null)
    const { value: _value, ...firstWithoutValue } = first
    return {
      ...firstWithoutValue,
      usedPct,
      remainingPct,
      resetsAt: resets.length > 0 ? Math.min(...resets) : null,
      primary: rows.some(quota => quota.primary),
      active: rows.some(quota => quota.active),
      displayOrder: Math.min(...rows.map(quota => quota.displayOrder)),
      valueText: `${Math.round(usedPct)}% used`,
    }
    }).sort((a, b) => roleOrder(a.role) - roleOrder(b.role) || a.displayOrder - b.displayOrder || a.key.localeCompare(b.key))
}

export function deriveProviderHeadroom(accounts: readonly HeadroomAccountInput[], activeTimeoutMin: number, now: number, displayMetric: 'smartHeadroom' | 'tightestRemaining' = 'smartHeadroom'): HeadroomView {
  const activeCutoff = now - activeTimeoutMin * 60_000
  const activeIds = accounts.filter(a => a.lastActivityAt !== null && a.lastActivityAt >= activeCutoff).map(a => a.id)
  if (displayMetric === 'smartHeadroom' && accounts.length > 1) {
    const pooled = accountHeadroom({ id: 'cumulative', lastActivityAt: null, quotas: cumulativeQuotaViews(accounts) })
    if (pooled.value === null) return { ...pooled, basis: 'unavailable', representativeAccountId: null, activeAccountIds: activeIds }
    const dataCount = accounts.filter(account => account.quotas.some(quota => quota.remainingPct !== null)).length
    return {
      ...pooled,
      basis: activeIds.length > 0 ? 'active' : 'idle-runway',
      representativeAccountId: null,
      activeAccountIds: activeIds,
      explanation: `${pooled.explanation}; ${dataCount} accounts combined`,
    }
  }
  const rows = accounts.map(account => {
    const smart = accountHeadroom(account)
    if (displayMetric === 'smartHeadroom') return { account, value: smart.value, view: smart }
    const floor = tightestQuotaView(account.quotas)
    const value = floor?.remainingPct ?? null
    return { account, value, view: { value, unit: 'index-100' as const, mode: floor ? 'fallback-floor' as const : 'unavailable' as const, factors: floor ? [{ key: floor.key, label: floor.label, role: floor.role, remainingPct: value!, included: true, reason: 'fallback-floor' as const }] : [], explanation: floor ? `Based on ${floor.label}` : 'No bounded quota data' } }
  }).filter(row => row.value !== null)
  if (rows.length === 0) return { value: null, unit: 'index-100', mode: 'unavailable', basis: 'unavailable', representativeAccountId: null, activeAccountIds: activeIds, factors: [], explanation: 'No bounded quota data' }
  const active = rows.filter(row => activeIds.includes(row.account.id))
  const candidates = active.length > 0 ? active : rows
  candidates.sort((a, b) => a.value !== b.value ? (active.length > 0 ? a.value! - b.value! : b.value! - a.value!) : active.length > 0 && a.account.lastActivityAt !== b.account.lastActivityAt ? (b.account.lastActivityAt ?? 0) - (a.account.lastActivityAt ?? 0) : a.account.id.localeCompare(b.account.id))
  const selected = candidates[0]!
  const basis = active.length > 0 ? 'active' : 'idle-runway'
  return { ...selected.view, basis, representativeAccountId: selected.account.id, activeAccountIds: activeIds, explanation: `${selected.view.explanation}; ${basis === 'active' ? 'active account' : 'best available account'}` }
}

export const headroomLabel = (view: HeadroomView | null | undefined): string => view?.value == null ? '—' : `H${Math.round(view.value)}`
