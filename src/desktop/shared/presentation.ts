import type { Config, Metric, WebAccount, WebSnapshot } from '../../web/contract'
import { MAX_PINNED_PROVIDERS, PROVIDER_ORDER } from '../../web/contract'
import { deriveQuotaView, resolveQuotaViews, type QuotaView } from '../../usage-semantics'
import { resetParts } from '../../shared/format'

// ── Severity ─────────────────────────────────────────────────────────────────
// The availability band + text tag are single-sourced in usage-semantics so the
// ≤10/≤25 thresholds live in exactly one place across every surface. Re-exported
// here for the desktop-local call sites (tray/tooltip colour) that already import
// from this module.
export { severity, severityTag, type Severity } from '../../usage-semantics'

// ── Quotas ───────────────────────────────────────────────────────────────────
export interface Quota {
  key: string
  /** Cleaned metric label, original case (e.g. "Session", "Weekly", "Credits"). */
  label: string
  /** Percent remaining (0–100), or null when the metric is unbounded / has no data. */
  remaining: number | null
  /** Percent consumed (0–100), or null when the metric is unbounded / has no data. */
  used: number | null
  resetsAt: number | null
  /** Provider-declared primary metric; wins ties for the headline. */
  primary: boolean
  /** A bounded metric gets a meter; unbounded (e.g. spend with no cap) is value-only. */
  bounded: boolean
  /** Right-aligned value text: "42% used" (bounded), "$1.20" (unbounded), "—" (no data). */
  valueText: string
}

function quotaFromView(view: QuotaView): Quota {
  return {
    key: view.key,
    label: view.label,
    remaining: view.remainingPct,
    used: view.usedPct,
    resetsAt: view.resetsAt,
    primary: view.primary,
    bounded: view.bounded,
    valueText: view.valueText,
  }
}

export function metricQuota(metric: Metric): Quota {
  return quotaFromView(deriveQuotaView(metric))
}

/** Canonical daemon order; raw metrics are parsed only for older snapshots. */
export function accountQuotas(account: WebAccount): Quota[] {
  return resolveQuotaViews({ quotas: account.quotas, metrics: account.billing?.metrics }).map(quotaFromView)
}

/**
 * The tightest bounded quota across a set — the section headline. Ties use the
 * canonical soonest-reset/key order shared with main and the daemon.
 */
export function tightestQuota(quotas: readonly Quota[]): Quota | null {
  const best = quotas.filter(quota => quota.remaining !== null).sort((a, b) =>
    a.remaining! - b.remaining!
    || (a.resetsAt ?? Infinity) - (b.resetsAt ?? Infinity)
    || a.key.localeCompare(b.key),
  )[0] ?? null
  // No bounded metric at all: fall back to the first value-only quota so the headline
  // still names something, rather than rendering an empty ring with no context.
  return best ?? quotas[0] ?? null
}

// ── Honest provider representative (never averages or pools) ──────────────────
// A provider's single tray/summary number is one real window of one real account:
//   • while any account is active → the lowest floor among active accounts;
//   • while none are active       → the highest floor (best runway) among accounts with data;
//   • with no bounded data anywhere → unknown.
// Ties break on soonest reset, then stable account id. See the semantics contract.

/** An account's floor = its tightest bounded window (min remaining); null if none bounded. */
export function accountFloor(account: WebAccount): Quota | null {
  return tightestQuota(accountQuotas(account))
}

/** Sum canonical local usage for the current day; null means the provider has no usage feed. */
export function providerTodayTokens(accounts: readonly WebAccount[]): number | null {
  const values = accounts.map(account => account.dashboard?.today.tokens).filter((value): value is number => value != null && Number.isFinite(value))
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) : null
}

export type RepresentativeBasis = 'active-floor' | 'idle-runway' | 'none'

export interface ProviderRepresentative {
  /** The chosen representative account; null only when the provider has no accounts at all. */
  account: WebAccount | null
  /** The exact window achieving that account's floor; null ⇒ no bounded data anywhere. */
  quota: Quota | null
  /** Was the representative drawn from the active set (active-floor rule)? */
  active: boolean
  /** Does any account in the provider have current activity (drives the Layer-1 beacon)? */
  providerActive: boolean
  /** True when no account has a single bounded window — the provider is "No data". */
  noData: boolean
  /** Tightest bounded remaining anywhere in the provider (the honest "tightest"). */
  floorPct: number | null
  /** Best available runway = highest account floor (the honest "most free"). */
  runwayPct: number | null
  /** Count of accounts contributing bounded data. */
  dataCount: number
  basis: RepresentativeBasis
}

interface RepView {
  account: WebAccount
  floor: Quota | null
  active: boolean
}

function pickRepresentative(views: readonly RepView[], mode: 'lowest' | 'highest'): RepView {
  return [...views].sort((a, b) => {
    const ra = a.floor!.remaining!
    const rb = b.floor!.remaining!
    if (ra !== rb) return mode === 'lowest' ? ra - rb : rb - ra
    const ta = a.floor!.resetsAt ?? Infinity
    const tb = b.floor!.resetsAt ?? Infinity
    if (ta !== tb) return ta - tb
    return a.account.id.localeCompare(b.account.id)
  })[0]!
}

/** Select the honest representative account/window for a provider's accounts. */
export function providerRepresentative(
  accounts: readonly WebAccount[],
  activeTimeoutMin: number,
  now: number,
): ProviderRepresentative {
  const views: RepView[] = accounts.map(account => ({
    account,
    floor: accountFloor(account),
    active: isActive(account, activeTimeoutMin, now),
  }))
  const providerActive = views.some(view => view.active)
  const withData = views.filter(view => view.floor && view.floor.remaining !== null)
  if (withData.length === 0) {
    return {
      account: accounts[0] ?? null, quota: null, active: false, providerActive,
      noData: true, floorPct: null, runwayPct: null, dataCount: 0, basis: 'none',
    }
  }
  const floors = withData.map(view => view.floor!.remaining!)
  const activeWithData = withData.filter(view => view.active)
  const chosen = activeWithData.length > 0
    ? pickRepresentative(activeWithData, 'lowest')
    : pickRepresentative(withData, 'highest')
  return {
    account: chosen.account,
    quota: chosen.floor,
    active: chosen.active,
    providerActive,
    noData: false,
    floorPct: Math.min(...floors),
    runwayPct: Math.max(...floors),
    dataCount: withData.length,
    basis: activeWithData.length > 0 ? 'active-floor' : 'idle-runway',
  }
}

/**
 * The honest compact secondary summary for a multi-account provider: two real
 * measured numbers, never an average. Null for single-account/agreeing providers.
 */
export function providerSecondarySummary(rep: ProviderRepresentative): string | null {
  if (rep.dataCount < 2 || rep.floorPct === null || rep.runwayPct === null) return null
  if (rep.floorPct === rep.runwayPct) return null
  return `highest usage ${percentText(100 - rep.floorPct)} · lowest usage ${percentText(100 - rep.runwayPct)}`
}

// ── Reset copy ────────────────────────────────────────────────────────────────
/**
 * "Xd Yh" / "Xh Ym" / "Xm"; two-unit at the day scale so a sub-day remainder
 * never hides. The desktop keeps its compact style (drops "0m" at the hour
 * scale), but the underlying rounding comes from the shared `resetParts` rule so
 * it can no longer disagree with the web/TUI relative label on a boundary.
 */
export function compactDuration(seconds: number): string | null {
  const parts = resetParts(seconds * 1000)
  if (!parts) return null
  if (parts.days > 0) return `${parts.days}d ${parts.hours}h`
  if (parts.hours > 0) return parts.minutes > 0 ? `${parts.hours}h ${parts.minutes}m` : `${parts.hours}h`
  return `${parts.minutes}m`
}

/** "Resets in 3h 25m" / "Resets soon" (≤5 min); null when the reset is unknown (omit it). */
export function resetLabel(resetsAt: number | null, now: number): string | null {
  if (resetsAt === null || !Number.isFinite(resetsAt)) return null
  const seconds = (resetsAt - now) / 1000
  if (seconds <= 5 * 60) return 'Resets soon'
  const duration = compactDuration(seconds)
  return duration ? `Resets in ${duration}` : 'Resets soon'
}

// ── Number formatting ────────────────────────────────────────────────────────
/** Compact usage numeral: no "%" glyph (won't fit at "100"), "<1" below one percent. */
export function usageNumberText(usage: number | null): string {
  if (usage === null || !Number.isFinite(usage)) return '—'
  if (usage > 0 && usage < 1) return '<1'
  return String(Math.round(usage))
}

/** Availability formatter retained for internal representative diagnostics. */
export function leftText(remaining: number): string {
  return remaining > 0 && remaining < 1 ? '<1%' : `${Math.round(remaining)}%`
}

/** Generic bounded percentage copy for usage-oriented UI. */
export function percentText(value: number): string {
  return value > 0 && value < 1 ? '<1%' : `${Math.round(value)}%`
}

/** Plan as plain text, price trivia removed; empty string means "no badge". */
export function planLabel(plan: string | null | undefined): string {
  if (!plan) return ''
  return plan
    .replace(/(?:\s*[·|]\s*)?\$\s*\d+(?:\.\d+)?(?:\s*\/\s*[a-z]+)?/gi, '')
    .trim()
}

// ── Provider grouping ────────────────────────────────────────────────────────
export interface ProviderGroup {
  providerId: string
  name: string
  accounts: WebAccount[]
  /** The single shared plan when every account agrees, else null (plan drops to rows). */
  sharedPlan: string | null
}

/**
 * Accounts grouped into provider sections in fixed PROVIDER_ORDER (never reordered by
 * activity). Within a provider, snapshot/config order is preserved.
 */
export function groupByProvider(snapshot: WebSnapshot): ProviderGroup[] {
  const nameOf = new Map(snapshot.providers.map(provider => [provider.id, provider.name]))
  const buckets = new Map<string, WebAccount[]>()
  for (const account of snapshot.accounts) {
    const list = buckets.get(account.providerId) ?? []
    list.push(account)
    buckets.set(account.providerId, list)
  }
  const order = (id: string) => {
    const index = PROVIDER_ORDER.indexOf(id as never)
    return index === -1 ? PROVIDER_ORDER.length : index
  }
  return [...buckets.keys()]
    .sort((a, b) => order(a) - order(b) || a.localeCompare(b))
    .map(providerId => {
      const accounts = buckets.get(providerId)!
      const plans = new Set(accounts.map(account => planLabel(account.plan)).filter(Boolean))
      return {
        providerId,
        name: nameOf.get(providerId as never) ?? PROVIDER_NAMES[providerId] ?? providerId,
        accounts,
        sharedPlan: plans.size === 1 ? [...plans][0]! : null,
      }
    })
}

/** Local display-name fallback used only when the snapshot omits a provider entry. */
const PROVIDER_NAMES: Record<string, string> = {
  claude: 'Claude', codex: 'Codex', cursor: 'Cursor', copilot: 'Copilot',
  pi: 'Pi', opencode: 'opencode', antigravity: 'Antigravity', gemini: 'Gemini', grok: 'Grok',
}

// ── Activity (emphasis only — never reorders, never touches pins) ─────────────
export function isActive(account: WebAccount, activeTimeoutMin: number, now: number): boolean {
  return account.lastActivityAt !== null && now - account.lastActivityAt <= activeTimeoutMin * 60_000
}

export function activeSince(account: WebAccount, now: number): string {
  const minutes = Math.max(0, Math.round((now - (account.lastActivityAt ?? now)) / 60_000))
  return minutes < 1 ? 'Active now' : `Active ${minutes}m ago`
}

// ── Freshness ────────────────────────────────────────────────────────────────
export type Freshness = 'live' | 'stale' | 'error' | 'nodata'

export function billingObservedAt(account: WebAccount): number | null {
  const asOf = account.billing?.asOfMs
  if (typeof asOf === 'number' && Number.isFinite(asOf) && asOf >= 0) return asOf
  const updatedAt = account.billingUpdatedAt
  return typeof updatedAt === 'number' && Number.isFinite(updatedAt) && updatedAt >= 0 ? updatedAt : null
}

export function billingStaleAfterMs(snapshot: WebSnapshot): number {
  const interval = snapshot.billingIntervalMs
  const normalized = typeof interval === 'number' && Number.isFinite(interval) && interval > 0
    ? interval
    : 300_000
  return Math.max(300_000, normalized * 2)
}

export function freshness(account: WebAccount, snapshot: WebSnapshot, now: number): Freshness {
  if (account.billingState === 'error') return 'error'
  if (!account.billing || account.billing.metrics.length === 0) return 'nodata'
  const observedAt = billingObservedAt(account)
  if (observedAt !== null && now - observedAt > billingStaleAfterMs(snapshot)) return 'stale'
  return 'live'
}

export function staleAgeLabel(account: WebAccount, now: number): string {
  const duration = compactDuration((now - (billingObservedAt(account) ?? now)) / 1000)
  return duration ? `As of ${duration} ago` : 'As of moments ago'
}

// ── Pins (provider-scoped, max 2, ordered = menu-bar order) ───────────────────
export const MAX_PINS = MAX_PINNED_PROVIDERS

function dedupeCap(ids: readonly string[], knownIds: ReadonlySet<string>): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of ids) {
    if (!id || seen.has(id) || !knownIds.has(id)) continue
    seen.add(id)
    out.push(id)
    if (out.length >= MAX_PINS) break
  }
  return out
}

/**
 * The effective provider-pin list (menu-bar order, ≤2). Prefers the provider-scoped
 * `tray.pinnedProviders`; when absent it tolerantly migrates legacy account-scoped
 * pins (`tray.pins`/`pinnedAccount`) to provider ids using the live snapshot. Already
 * provider-shaped legacy ids stay valid. Unknown ids are dropped, order preserved.
 */
export function resolveProviderPins(config: Config, snapshot: WebSnapshot): string[] {
  const knownProviders = new Set<string>(snapshot.providers.map(provider => provider.id))
  for (const account of snapshot.accounts) knownProviders.add(account.providerId)

  const explicit = readProviderPins(config)
  if (explicit.length > 0) return dedupeCap(explicit, knownProviders)

  // Migration: map each legacy account id to its provider; keep already-provider ids.
  const providerOf = new Map(snapshot.accounts.map(account => [account.id, account.providerId as string]))
  const migrated = readPins(config)
    .map(id => providerOf.get(id) ?? (knownProviders.has(id) ? id : null))
    .filter((id): id is string => id !== null)
  return dedupeCap(migrated, knownProviders)
}

/** Raw persisted provider pins — the provider-scoped source of truth. */
export function readProviderPins(config: Config): string[] {
  const tray = config.tray as { pinnedProviders?: unknown }
  return Array.isArray(tray.pinnedProviders)
    ? tray.pinnedProviders.filter((id): id is string => typeof id === 'string')
    : []
}

/** Raw legacy account-scoped pins — `tray.pins` if present, else the older single field. */
export function readPins(config: Config): string[] {
  const tray = config.tray as { pins?: unknown; pinnedAccount?: string | null }
  if (Array.isArray(tray.pins)) return tray.pins.filter((id): id is string => typeof id === 'string')
  return tray.pinnedAccount ? [tray.pinnedAccount] : []
}

export interface PinToggleResult {
  pins: string[]
  /** True when a third pin was rejected — the caller shows the "Up to 2 pins" toast. */
  rejected: boolean
}

/** Toggle `id`: remove if pinned, add if room, else reject (config unchanged). */
export function togglePin(current: readonly string[], id: string): PinToggleResult {
  if (current.includes(id)) return { pins: current.filter(pin => pin !== id), rejected: false }
  if (current.length >= MAX_PINS) return { pins: [...current], rejected: true }
  return { pins: [...current, id], rejected: false }
}

// ── Accessibility ────────────────────────────────────────────────────────────
export function usageAriaValueText(
  subject: string,
  used: number | null,
  resetsAt: number | null,
  now: number,
): string {
  if (used === null) return `${subject}, no usage data`
  const reset = resetLabel(resetsAt, now)
  const spoken = reset ? `, ${reset.toLowerCase()}` : ''
  return `${subject}, ${Math.round(used)} percent used${spoken}`
}

// ── Menu-bar strip geometry ───────────────────────────────────────────────────
// The tray/menu-bar canvas geometry lives in its own module; re-exported here so
// the desktop-local call sites that import from this barrel keep working.
export * from './tray-strip-geometry'
