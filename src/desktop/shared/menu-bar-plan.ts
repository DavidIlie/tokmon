import type { Config, MenuBarConfig, MenuBarDensity } from '../../config-schema'
import type { WebAccount, WebSnapshot } from '../../web/contract'
import { formatCompactTokens } from '../../shared/format'
import { resolveQuotaViews, usageFromHeadroom } from '../../usage-semantics'

export interface MenuBarSegmentValue {
  providerId: string
  /** Representative usage percentage (consumed), or null when no bounded value exists. */
  usage: number | null
  /** Alternate display value, for example today's compact token total. */
  label?: string
  active: boolean
}

export interface RetainedMenuBarValue {
  value: MenuBarSegmentValue
  usageObservedAt: number | null
  labelObservedAt: number | null
  mode: 'usage' | 'todayTokens'
}

/**
 * Preserve a provider's last-known display value through a transient empty
 * refresh. Expired or genuinely never-observed providers resolve to unknown.
 */
export function retainMenuBarValues(
  previous: ReadonlyMap<string, RetainedMenuBarValue>,
  next: readonly MenuBarSegmentValue[],
  now: number,
  retainForMs: number,
  mode: 'usage' | 'todayTokens',
): { values: MenuBarSegmentValue[]; memory: Map<string, RetainedMenuBarValue> } {
  const memory = new Map<string, RetainedMenuBarValue>()
  const values = next.map(value => {
    const retained = previous.get(value.providerId)
    const compatible = retained?.mode === mode ? retained : null
    const usageKnown = finiteUsage(value.usage) !== null
    const retainedUsageFresh = compatible?.usageObservedAt !== null
      && compatible?.usageObservedAt !== undefined
      && now - compatible.usageObservedAt <= retainForMs
    const resolvedUsage = usageKnown
      ? value.usage
      : retainedUsageFresh ? compatible.value.usage : value.usage

    const labelKnown = mode === 'todayTokens' && value.label !== undefined && value.label !== '–'
    const retainedLabelFresh = compatible?.labelObservedAt !== null
      && compatible?.labelObservedAt !== undefined
      && now - compatible.labelObservedAt <= retainForMs
    const resolvedLabel = mode === 'todayTokens'
      ? labelKnown ? value.label : retainedLabelFresh ? compatible.value.label : value.label
      : value.label

    const resolved = { ...value, usage: resolvedUsage, ...(resolvedLabel === undefined ? {} : { label: resolvedLabel }) }
    const usageObservedAt = usageKnown ? now : retainedUsageFresh ? compatible.usageObservedAt : null
    const labelObservedAt = labelKnown ? now : retainedLabelFresh ? compatible.labelObservedAt : null
    if (usageObservedAt !== null || labelObservedAt !== null) {
      memory.set(value.providerId, { value: resolved, usageObservedAt, labelObservedAt, mode })
    }
    return resolved
  })
  return { values, memory }
}

export interface MenuBarDensityTokens {
  height: number
  edgePadding: number
  markValueGap: number
  providerGap: number
  iconBox: number
  fontPx: number
  progressWidth: number
  progressHeight: number
}

export const MENU_BAR_DENSITIES: Record<MenuBarDensity, MenuBarDensityTokens> = {
  comfortable: {
    height: 22, edgePadding: 1, markValueGap: 3, providerGap: 8,
    iconBox: 13, fontPx: 11, progressWidth: 13, progressHeight: 1.5,
  },
  compact: {
    height: 22, edgePadding: 0.5, markValueGap: 2, providerGap: 5.5,
    iconBox: 12, fontPx: 11, progressWidth: 12, progressHeight: 1.5,
  },
  tight: {
    height: 22, edgePadding: 0, markValueGap: 1.5, providerGap: 4,
    iconBox: 11, fontPx: 10, progressWidth: 11, progressHeight: 1,
  },
}

export interface MenuBarSegmentPlan extends MenuBarSegmentValue {
  label: string
  critical: boolean
  showProviderMark: boolean
  showValue: boolean
  showProgress: boolean
  x: number
  width: number
  iconX: number | null
  valueLeft: number | null
  valueCenterX: number | null
  progressX: number | null
  progressY: number | null
  /** Null paints track-only; otherwise clamped 0…1 fill fraction. */
  progressFraction: number | null
}

export interface MenuBarPlan {
  width: number
  height: number
  density: MenuBarDensity
  tokens: MenuBarDensityTokens
  segments: MenuBarSegmentPlan[]
  valueSlotWidth: number
  /** Stable width reserved outside provider boundaries to prevent native reflow. */
  reservedSlack: number
  /** Offset applied to the literal provider geometry within the stable image. */
  contentOffsetX: number
  /** The heuristic budget used by auto mode. Null means custom mode is literal. */
  budget: number | null
  /** True when auto mode hid any requested content to fit its heuristic budget. */
  collapsed: boolean
}

export interface BuildMenuBarPlanInput {
  values: readonly MenuBarSegmentValue[]
  config: MenuBarConfig
  /** Width of the display in device-independent points. */
  displayWidthPt: number
  /** Primarily useful for deterministic preview/test constraints. */
  availableWidthPt?: number
  measureText: (text: string, font: string) => number
}

export interface MenuBarRenderSignatureInput {
  configRevision: number
  snapshotGeneratedAt: number
  values: readonly MenuBarSegmentValue[]
  config: MenuBarConfig
  valueMode?: 'usage' | 'todayTokens'
  displayWidthPt: number
  updateReady: boolean
  updateStatus?: string
}

const DENSITY_ORDER: MenuBarDensity[] = ['comfortable', 'compact', 'tight']

const half = (value: number) => Math.ceil(value * 2) / 2
const finiteUsage = (usage: number | null): number | null =>
  usage !== null && Number.isFinite(usage) ? Math.max(0, Math.min(100, usage)) : null

function todayTokens(accounts: readonly WebAccount[]): number | null {
  const values = accounts
    .map(account => account.dashboard?.today.tokens)
    .filter((value): value is number => value !== undefined && Number.isFinite(value))
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) : null
}

function accountFloor(account: WebAccount): { remaining: number; resetsAt: number | null } | null {
  const bounded = resolveQuotaViews({ quotas: account.quotas, metrics: account.billing?.metrics })
    .filter(quota => quota.remainingPct !== null)
    .sort((a, b) => a.remainingPct! - b.remainingPct!
      || (a.resetsAt ?? Infinity) - (b.resetsAt ?? Infinity)
      || a.key.localeCompare(b.key))
  const floor = bounded[0]
  return floor ? { remaining: floor.remainingPct!, resetsAt: floor.resetsAt } : null
}

/**
 * Deterministic shared model for native pixels and main-process validation.
 * Activity is evaluated at snapshot generation time, so renderer/main cannot
 * disagree at a live timeout boundary while validating the same snapshot.
 */
export function menuBarValuesFromSnapshot(
  snapshot: WebSnapshot,
  config: Config,
  pins: readonly string[],
): MenuBarSegmentValue[] {
  return pins.slice(0, 2).map(providerId => {
    const provider = snapshot.providers.find(candidate => candidate.id === providerId)
    const accounts = snapshot.accounts.filter(account => account.providerId === providerId)
    const label = config.tray.menuBarValue === 'todayTokens'
      ? formatCompactTokens(todayTokens(accounts))
      : undefined
    if (provider?.headroom) {
      return {
        providerId,
        usage: usageFromHeadroom(provider.headroom.value),
        ...(label === undefined ? {} : { label }),
        active: provider.headroom.activeAccountIds.length > 0,
      }
    }
    const rows = accounts.map(account => ({
      account,
      floor: accountFloor(account),
      active: account.lastActivityAt !== null
        && snapshot.generatedAt - account.lastActivityAt <= config.tray.activeTimeoutMin * 60_000,
    }))
    const withData = rows.filter((row): row is typeof row & { floor: NonNullable<typeof row.floor> } => row.floor !== null)
    const activeRows = withData.filter(row => row.active)
    const candidates = activeRows.length > 0 ? activeRows : withData
    const chosen = [...candidates].sort((a, b) => {
      const usageOrder = activeRows.length > 0
        ? a.floor.remaining - b.floor.remaining
        : b.floor.remaining - a.floor.remaining
      return usageOrder
        || (a.floor.resetsAt ?? Infinity) - (b.floor.resetsAt ?? Infinity)
        || a.account.id.localeCompare(b.account.id)
    })[0]
    return {
      providerId,
      usage: usageFromHeadroom(chosen?.floor.remaining ?? null),
      ...(label === undefined ? {} : { label }),
      active: rows.some(row => row.active),
    }
  })
}

/** The usage numeral: "7%", "<1%", "100%", or an en dash for unknown. */
export function menuBarLabel(usage: number | null): string {
  const value = finiteUsage(usage)
  if (value === null) return '–'
  if (value > 0 && value < 1) return '<1%'
  return `${Math.round(value)}%`
}

/** Stable bucket is part of the render signature, not the exact display width. */
export function menuBarDisplayBucket(displayWidthPt: number): 'wide' | 'compact' | 'tight' {
  if (displayWidthPt >= 1440) return 'wide'
  if (displayWidthPt >= 1280) return 'compact'
  return 'tight'
}

/** Conservative budget: Electron cannot observe space occupied by other status items. */
export function menuBarWidthBudget(displayWidthPt: number): number {
  const bucket = menuBarDisplayBucket(displayWidthPt)
  if (bucket === 'wide') return 176
  if (bucket === 'compact') return 132
  return 96
}

function autoDensity(chosen: MenuBarDensity, displayWidthPt: number): MenuBarDensity {
  const floor: MenuBarDensity = displayWidthPt >= 1440
    ? chosen
    : displayWidthPt >= 1280 ? 'compact' : 'tight'
  return DENSITY_ORDER[Math.max(DENSITY_ORDER.indexOf(chosen), DENSITY_ORDER.indexOf(floor))]!
}

function tokensFor(config: MenuBarConfig, density: MenuBarDensity): MenuBarDensityTokens {
  const base = MENU_BAR_DENSITIES[density]
  if (config.mode !== 'custom') return base
  return {
    ...base,
    edgePadding: config.customSpacing.edgePaddingPt,
    markValueGap: config.customSpacing.markValueGapPt,
    providerGap: config.customSpacing.providerGapPt,
  }
}

interface Visibility {
  mark: boolean
  value: boolean
  progress: boolean
  present: boolean
}

function requestedVisibility(config: MenuBarConfig, count: number): Visibility[] {
  const requested = config.elements
  // An entirely blank configuration is impossible to discover or recover from in
  // a native status item. Provider marks are therefore the documented safety floor.
  const recovery = !requested.providerMark && !requested.value && !requested.progress
  return Array.from({ length: count }, () => ({
    mark: recovery || requested.providerMark,
    value: requested.value,
    progress: requested.progress,
    present: true,
  }))
}

function createPlan(
  values: readonly MenuBarSegmentValue[],
  visibility: readonly Visibility[],
  config: MenuBarConfig,
  density: MenuBarDensity,
  measureText: BuildMenuBarPlanInput['measureText'],
  budget: number | null,
  collapsed: boolean,
): MenuBarPlan {
  const tokens = tokensFor(config, density)
  const font = `500 ${tokens.fontPx}px -apple-system, system-ui, sans-serif`
  const effectiveVisibility = visibility.map(item => ({ ...item }))
  if (values.length > 0 && !effectiveVisibility.some(item => item.present && (item.mark || item.value || item.progress))) {
    effectiveVisibility[0] = { mark: true, value: false, progress: false, present: true }
  }
  const visibleValues = values
    .map((value, index) => ({ value, visibility: effectiveVisibility[index]! }))
    .filter(item => item.visibility.present && (item.visibility.mark || item.visibility.value || item.visibility.progress))
  const labels = visibleValues.map(({ value }) => value.label ?? menuBarLabel(value.usage))
  const valueSlotWidth = half(Math.max(0, ...labels.map(label => measureText(label, font))))

  let cursor = tokens.edgePadding
  const segments: MenuBarSegmentPlan[] = []
  visibleValues.forEach(({ value, visibility: show }, index) => {
    if (index > 0) cursor += tokens.providerGap
    const x = cursor
    let contentWidth = 0
    let iconX: number | null = null
    let valueLeft: number | null = null
    if (show.mark) {
      iconX = cursor
      contentWidth += tokens.iconBox
      cursor += tokens.iconBox
    }
    const label = value.label ?? menuBarLabel(value.usage)
    const labelWidth = half(measureText(label, font))
    if (show.value) {
      if (show.mark) {
        cursor += tokens.markValueGap
        contentWidth += tokens.markValueGap
      }
      valueLeft = cursor
      contentWidth += labelWidth
      cursor += labelWidth
    }
    const width = Math.max(contentWidth, show.progress ? tokens.progressWidth : 0)
    // Centre a progress-only or wider progress element below the content without
    // changing the mark/value optical relationship.
    if (width > contentWidth) cursor += width - contentWidth
    segments.push({
      ...value,
      label,
      critical: finiteUsage(value.usage) !== null && finiteUsage(value.usage)! >= 90,
      showProviderMark: show.mark,
      showValue: show.value,
      showProgress: show.progress,
      x,
      width,
      iconX,
      valueLeft,
      valueCenterX: valueLeft === null ? null : valueLeft + labelWidth / 2,
      progressX: show.progress ? x + (width - tokens.progressWidth) / 2 : null,
      progressY: show.progress ? tokens.height - tokens.progressHeight - 1 : null,
      progressFraction: finiteUsage(value.usage) === null ? null : finiteUsage(value.usage)! / 100,
    })
  })

  const actualProviderWidth = segments.length === 0 ? 0 : cursor + tokens.edgePadding
  const reservedSlack = 0
  const contentOffsetX = 0
  const providerWidth = actualProviderWidth
  // Keep every valid plan inside the native IPC contract. Tight mark-only and
  // progress-only layouts are 11pt intrinsically, but Electron status items
  // need the same 12pt discoverable floor as the procedural fallback icon.
  const width = Math.max(12, providerWidth)
  return {
    width, height: tokens.height, density, tokens, segments, valueSlotWidth,
    reservedSlack, contentOffsetX, budget, collapsed,
  }
}

/**
 * Pure production layout shared by native painting and settings previews.
 * Auto mode follows one deterministic degradation ladder and never mutates pins.
 */
export function buildMenuBarPlan(input: BuildMenuBarPlanInput): MenuBarPlan {
  const values = input.values.slice(0, 2)
  const initialDensity = input.config.mode === 'auto'
    ? autoDensity(input.config.density, input.displayWidthPt)
    : input.config.density
  const budget = input.config.mode === 'auto'
    ? (input.availableWidthPt ?? menuBarWidthBudget(input.displayWidthPt))
    : null
  const visibility = requestedVisibility(input.config, values.length)
  let density = initialDensity
  let collapsed = false
  let plan = createPlan(values, visibility, input.config, density, input.measureText, budget, collapsed)
  if (budget === null || plan.width <= budget) return plan

  const rebuild = () => {
    collapsed = true
    plan = createPlan(values, visibility, input.config, density, input.measureText, budget, collapsed)
  }
  if (density !== 'tight') {
    density = 'tight'
    rebuild()
  }
  const hide = (index: number, key: 'progress' | 'value') => {
    const item = visibility[index]
    if (!item || !item.present || !item[key]) return
    item[key] = false
    rebuild()
  }
  // Secondary content yields before primary content, with progress before value.
  if (plan.width > budget) hide(1, 'progress')
  if (plan.width > budget) hide(0, 'progress')
  if (plan.width > budget) hide(1, 'value')
  if (plan.width > budget) hide(0, 'value')
  if (plan.width > budget && visibility[1]) {
    visibility[1]!.present = false
    rebuild()
  }
  if (plan.width > budget && visibility[0]) {
    visibility[0] = { mark: true, value: false, progress: false, present: true }
    density = 'tight'
    rebuild()
  }
  return plan
}

/** Stable, serialisable signature over every leaf that can affect native pixels. */
export function menuBarRenderSignature(input: MenuBarRenderSignatureInput): string {
  const menuBar = input.config
  return JSON.stringify({
    revision: input.configRevision,
    generatedAt: input.snapshotGeneratedAt,
    providers: input.values.map(value => [
      value.providerId,
      finiteUsage(value.usage),
      value.label ?? null,
      value.active,
    ]),
    presentation: [
      menuBar.version,
      menuBar.mode,
      menuBar.elements.providerMark,
      menuBar.elements.value,
      menuBar.elements.progress,
      menuBar.density,
      menuBar.customSpacing.edgePaddingPt,
      menuBar.customSpacing.markValueGapPt,
      menuBar.customSpacing.providerGapPt,
      input.valueMode ?? 'usage',
    ],
    displayBucket: menuBarDisplayBucket(input.displayWidthPt),
    updateState: input.updateStatus ?? (input.updateReady ? 'downloaded' : 'not-ready'),
  })
}
