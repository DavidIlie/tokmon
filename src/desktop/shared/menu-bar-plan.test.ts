import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_MENU_BAR_CONFIG, type MenuBarConfig } from '../../config-schema'
import { isTrayStripPayload, type TrayStripPayload } from './desktop-contract'
import {
  buildMenuBarPlan,
  MENU_BAR_DENSITIES,
  menuBarDisplayBucket,
  menuBarRenderSignature,
  retainMenuBarValues,
  type MenuBarSegmentValue,
} from './menu-bar-plan'

const measure = (text: string) => text.length * 6
const values: MenuBarSegmentValue[] = [
  { providerId: 'claude', usage: 42, active: true },
  { providerId: 'codex', usage: 17, active: false },
]

function config(patch: Partial<MenuBarConfig> = {}): MenuBarConfig {
  return {
    ...DEFAULT_MENU_BAR_CONFIG,
    ...patch,
    elements: { ...DEFAULT_MENU_BAR_CONFIG.elements, ...patch.elements },
    customSpacing: { ...DEFAULT_MENU_BAR_CONFIG.customSpacing, ...patch.customSpacing },
  }
}

test('comfortable production geometry is exact and keeps migrated default proportions', () => {
  const plan = buildMenuBarPlan({
    values,
    config: config({ mode: 'custom' }),
    displayWidthPt: 1440,
    measureText: measure,
  })
  assert.deepEqual(plan.tokens, MENU_BAR_DENSITIES.comfortable)
  assert.equal(plan.valueSlotWidth, 18)
  assert.equal(plan.reservedSlack, 0)
  assert.equal(plan.contentOffsetX, 0)
  assert.equal(plan.segments[0]?.x, 1)
  assert.equal(plan.segments[0]?.width, 34)
  assert.equal(plan.segments[1]?.x, 43)
  assert.equal(plan.width, 78)
  assert.equal(plan.height, 22)
})

test('visibility combinations recover an all-hidden strip to provider marks', () => {
  const markOnly = buildMenuBarPlan({
    values,
    config: config({ mode: 'custom', elements: { providerMark: true, value: false, progress: false } }),
    displayWidthPt: 1440,
    measureText: measure,
  })
  assert.equal(markOnly.segments[0]?.width, 13)
  assert.equal(markOnly.segments[0]?.showValue, false)

  const progressOnly = buildMenuBarPlan({
    values: values.slice(0, 1),
    config: config({ mode: 'custom', elements: { providerMark: false, value: false, progress: true } }),
    displayWidthPt: 1440,
    measureText: measure,
  })
  assert.equal(progressOnly.segments[0]?.width, 13)
  assert.equal(progressOnly.segments[0]?.showProgress, true)

  const recovered = buildMenuBarPlan({
    values: values.slice(0, 1),
    config: config({ mode: 'custom', elements: { providerMark: false, value: false, progress: false } }),
    displayWidthPt: 1440,
    measureText: measure,
  })
  assert.equal(recovered.segments[0]?.showProviderMark, true)
  assert.equal(recovered.width, 15)

  const tightMarkOnly = buildMenuBarPlan({
    values: values.slice(0, 1),
    config: config({
      mode: 'custom',
      density: 'tight',
      elements: { providerMark: true, value: false, progress: false },
      customSpacing: { edgePaddingPt: 0, markValueGapPt: 0, providerGapPt: 0 },
    }),
    displayWidthPt: 1440,
    measureText: measure,
  })
  assert.equal(tightMarkOnly.segments[0]?.width, 11)
  assert.equal(tightMarkOnly.width, 12)
})

test('auto density is monotonic and collapses secondary content first without changing pins', () => {
  const wide = buildMenuBarPlan({ values, config: config(), displayWidthPt: 1600, measureText: measure })
  const compact = buildMenuBarPlan({ values, config: config(), displayWidthPt: 1300, measureText: measure })
  const tight = buildMenuBarPlan({ values, config: config(), displayWidthPt: 1200, measureText: measure })
  assert.equal(wide.density, 'comfortable')
  assert.equal(compact.density, 'compact')
  assert.equal(tight.density, 'tight')
  assert.ok(wide.width >= compact.width)
  assert.ok(compact.width >= tight.width)

  const densityOnly = buildMenuBarPlan({
    values,
    config: config({ elements: { providerMark: true, value: true, progress: true } }),
    displayWidthPt: 1600,
    availableWidthPt: 68,
    measureText: measure,
  })
  assert.equal(densityOnly.density, 'tight')
  assert.equal(densityOnly.collapsed, true)
  assert.equal(densityOnly.segments[0]?.showProgress, true)
  assert.equal(densityOnly.segments[1]?.showProgress, true)

  const constrained = buildMenuBarPlan({
    values,
    config: config({ elements: { providerMark: true, value: true, progress: true } }),
    displayWidthPt: 1600,
    availableWidthPt: 48,
    measureText: measure,
  })
  assert.deepEqual(constrained.segments.map(segment => segment.providerId), ['claude', 'codex'])
  assert.equal(constrained.segments[0]?.showValue, true)
  assert.equal(constrained.segments[1]?.showValue, false)
  assert.equal(constrained.segments[1]?.showProgress, false)

  const finalFloor = buildMenuBarPlan({
    values,
    config: config(),
    displayWidthPt: 1600,
    availableWidthPt: 12,
    measureText: measure,
  })
  assert.deepEqual(finalFloor.segments.map(segment => segment.providerId), ['claude'])
  assert.equal(finalFloor.density, 'tight')
  assert.equal(finalFloor.segments[0]?.showProviderMark, true)
  assert.equal(finalFloor.segments[0]?.showValue, false)

  const progressFloor = buildMenuBarPlan({
    values,
    config: config({ elements: { providerMark: false, value: false, progress: true } }),
    displayWidthPt: 1600,
    availableWidthPt: 1,
    measureText: measure,
  })
  assert.equal(progressFloor.segments.length, 1)
  assert.equal(progressFloor.segments[0]?.showProviderMark, true)
})

test('custom mode uses literal spacing and never auto-collapses', () => {
  const custom = buildMenuBarPlan({
    values,
    config: config({
      mode: 'custom', density: 'compact',
      customSpacing: { edgePaddingPt: 2, markValueGapPt: 4, providerGapPt: 7 },
    }),
    displayWidthPt: 800,
    availableWidthPt: 12,
    measureText: measure,
  })
  assert.equal(custom.density, 'compact')
  assert.equal(custom.tokens.edgePadding, 2)
  assert.equal(custom.tokens.markValueGap, 4)
  assert.equal(custom.tokens.providerGap, 7)
  assert.equal(custom.segments.length, 2)
  assert.equal(custom.collapsed, false)
})

test('custom zero spacing adds no hidden outer reserve or inter-provider gap', () => {
  const zeroGapConfig = config({
    mode: 'custom', density: 'tight',
    customSpacing: { edgePaddingPt: 0, markValueGapPt: 0, providerGapPt: 0 },
  })
  const plan = buildMenuBarPlan({
    values: [
      { providerId: 'claude', usage: 42, label: '38M', active: false },
      { providerId: 'codex', usage: 17, label: '69M', active: false },
    ],
    config: zeroGapConfig,
    displayWidthPt: 1440,
    measureText: measure,
  })
  assert.equal(plan.segments[1]!.x, plan.segments[0]!.x + plan.segments[0]!.width)
  assert.equal(plan.reservedSlack, 0)
  assert.equal(plan.contentOffsetX, 0)
  assert.equal(plan.width, plan.segments[1]!.x + plan.segments[1]!.width)
})

test('auto mode follows visible content instead of reserving hidden sentinel width', () => {
  const build = (label: string) => buildMenuBarPlan({
    values: [{ providerId: 'claude', usage: null, label, active: false }],
    config: config({ mode: 'auto' }),
    displayWidthPt: 1440,
    measureText: measure,
  })
  const short = build('1K')
  const long = build('1.2M')
  assert.equal(short.reservedSlack, 0)
  assert.equal(short.contentOffsetX, 0)
  assert.ok(short.width < long.width)
})

test('transient unknown values retain the last-known provider value until stale', () => {
  const known: MenuBarSegmentValue = { providerId: 'claude', usage: 42, active: true }
  const first = retainMenuBarValues(new Map(), [known], 1_000, 300_000, 'usage')
  assert.deepEqual(first.values, [known])

  const transient = retainMenuBarValues(
    first.memory,
    [{ providerId: 'claude', usage: null, active: false }],
    2_000,
    300_000,
    'usage',
  )
  assert.deepEqual(transient.values, [{ ...known, active: false }])

  const stale = retainMenuBarValues(
    transient.memory,
    [{ providerId: 'claude', usage: null, active: false }],
    302_000,
    300_000,
    'usage',
  )
  assert.deepEqual(stale.values, [{ providerId: 'claude', usage: null, active: false }])
})

test('token mode treats an en dash as unknown but zero tokens as observed', () => {
  const known: MenuBarSegmentValue = { providerId: 'codex', usage: 42, label: '0', active: false }
  const first = retainMenuBarValues(new Map(), [known], 1_000, 300_000, 'todayTokens')
  const retained = retainMenuBarValues(
    first.memory,
    [{ providerId: 'codex', usage: 80, label: '–', active: true }],
    2_000,
    300_000,
    'todayTokens',
  )
  assert.deepEqual(retained.values, [{ ...known, usage: 80, active: true }])

  const missingQuota = retainMenuBarValues(
    first.memory,
    [{ providerId: 'codex', usage: null, label: '12M', active: true }],
    2_000,
    300_000,
    'todayTokens',
  )
  assert.deepEqual(missingQuota.values, [{ providerId: 'codex', usage: 42, label: '12M', active: true }])
})

test('last-known values never cross the usage and token display modes', () => {
  const usage: MenuBarSegmentValue = { providerId: 'claude', usage: 42, active: false }
  const usageMemory = retainMenuBarValues(new Map(), [usage], 1_000, 300_000, 'usage').memory
  const missingTokens: MenuBarSegmentValue = { providerId: 'claude', usage: 42, label: '–', active: false }
  assert.deepEqual(
    retainMenuBarValues(usageMemory, [missingTokens], 2_000, 300_000, 'todayTokens').values,
    [missingTokens],
  )

  const tokens: MenuBarSegmentValue = { providerId: 'claude', usage: 42, label: '38M', active: false }
  const tokenMemory = retainMenuBarValues(new Map(), [tokens], 1_000, 300_000, 'todayTokens').memory
  const missingUsage: MenuBarSegmentValue = { providerId: 'claude', usage: null, active: false }
  assert.deepEqual(
    retainMenuBarValues(tokenMemory, [missingUsage], 2_000, 300_000, 'usage').values,
    [missingUsage],
  )
})

test('progress plan distinguishes zero, sub-one, half, full, and unknown without geometry shifts', () => {
  const usages = [0, 0.4, 50, 100, null]
  const plans = usages.map(usage => buildMenuBarPlan({
    values: [{ providerId: 'claude', usage, active: false }],
    config: config({ mode: 'custom', elements: { providerMark: false, value: false, progress: true } }),
    displayWidthPt: 1440,
    measureText: measure,
  }))
  assert.deepEqual(plans.map(plan => plan.segments[0]?.progressFraction), [0, 0.004, 0.5, 1, null])
  assert.equal(new Set(plans.map(plan => plan.width)).size, 1)
})

test('an empty plan keeps the native discoverability floor without an action glyph', () => {
  const plan = buildMenuBarPlan({
    values: [],
    config: config(),
    displayWidthPt: 1440,
    measureText: measure,
  })
  assert.equal(plan.width, 12)
  assert.deepEqual(plan.segments, [])
})

test('render signature changes for every presentation leaf and only buckets display width', () => {
  const base = {
    configRevision: 2,
    snapshotGeneratedAt: 10,
    values,
    config: config(),
    displayWidthPt: 1440,
    updateReady: false,
    updateStatus: 'idle',
  }
  const signature = menuBarRenderSignature(base)
  const variants = [
    { ...base, configRevision: 3 },
    { ...base, snapshotGeneratedAt: 11 },
    { ...base, values: [{ ...values[0]!, usage: 43 }, values[1]!] },
    { ...base, values: [{ ...values[0]!, active: false }, values[1]!] },
    { ...base, config: config({ density: 'compact' }) },
    { ...base, config: config({ elements: { providerMark: true, value: false, progress: false } }) },
    { ...base, config: config({ customSpacing: { edgePaddingPt: 2, markValueGapPt: 3, providerGapPt: 8 } }) },
    { ...base, displayWidthPt: 1300 },
    { ...base, updateReady: true, updateStatus: 'downloaded' },
  ]
  for (const variant of variants) assert.notEqual(menuBarRenderSignature(variant), signature)
  assert.equal(menuBarDisplayBucket(1600), menuBarDisplayBucket(1440))
  assert.equal(menuBarRenderSignature({ ...base, displayWidthPt: 1600 }), signature)
})

test('tray strip IPC validation accepts icon-only widths and rejects oversized or incomplete payloads', () => {
  const valid: TrayStripPayload = {
    dataUrl1x: 'data:image/png;base64,AA==',
    dataUrl2x: 'data:image/png;base64,AA==',
    logicalWidth: 12,
    updateReady: false,
    configRevision: 2,
    snapshotGeneratedAt: 10,
    pinSignature: 'claude',
    displayWidthPt: 1440,
    renderSignature: '{}',
  }
  assert.equal(isTrayStripPayload(valid), true)
  assert.equal(isTrayStripPayload({ ...valid, logicalWidth: 11.5 }), false)
  assert.equal(isTrayStripPayload({ ...valid, logicalWidth: 225 }), false)
  assert.equal(isTrayStripPayload({ ...valid, renderSignature: '' }), false)
  assert.equal(isTrayStripPayload({ ...valid, displayWidthPt: Number.NaN }), false)
})
