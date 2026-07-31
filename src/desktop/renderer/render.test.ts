import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { DEFAULTS, type Config, type DashboardData, type Metric, type UsageSummary, type WebAccount, type WebSnapshot } from '../../web/contract'
import {
  patchMenuBarPresentation,
  resetMenuBarPresentation,
  setMenuBarElementVisibility,
  setMenuBarValue,
} from '../../web/contract'
import { repairAppearance, resolveTheme } from '../../theme'
import { Footer, TotalsBar, UpdateReady } from './desktop-chrome'
import {
  applyThemePreset,
  DesktopSettings,
  MenuBarSettings,
  ProvidersSettings,
  SettingsHub,
  ThemeSettings,
} from './desktop-settings'
import { ProviderCard } from './provider-card'
import { groupByProvider } from './presentation'
import { providerMark } from './provider-icons'
import {
  measuredPopoverHeight,
  pinProviderFromCard,
  pinProviderPreservingStoredPins,
  snapshotWithAccountPolicy,
} from './app'

// Server-render the components (no window, no effects) to catch runtime crashes in the
// provider-disclosure UI that pure-function unit tests can't reach.

const RESETS = new Date(Date.now() + 3 * 3_600_000 + 25 * 60_000).toISOString()

const metric = (over: Partial<Metric>): Metric => ({
  label: 'Session', used: 0, limit: 100, format: { kind: 'percent' }, resetsAt: RESETS, ...over,
})

const usage = (over: Partial<UsageSummary> = {}): UsageSummary => ({
  cost: 0, tokens: 0, input: 0, cacheRead: 0, cacheSavings: 0, ...over,
})

const dashboard = (over: Partial<DashboardData> = {}): DashboardData => ({
  today: usage(), week: usage(), month: usage(), burnRate: 0, series: [], lastActivityAt: null, ...over,
})

const account = (over: Partial<WebAccount>): WebAccount => ({
  id: 'a', providerId: 'claude', name: 'Claude', color: 'green', homeDir: null,
  hasUsage: true, hasBilling: true, email: 'a@example.com', displayName: null, plan: 'Pro',
  lastActivityAt: null, dashboard: null, table: null,
  billing: { plan: 'Pro', metrics: [metric({})], error: null },
  summaryState: 'ready', billingState: 'ready', tableState: 'ready',
  summaryUpdatedAt: null, billingUpdatedAt: Date.now(), tableUpdatedAt: null, ...over,
})

const snapshot = (accounts: WebAccount[]): WebSnapshot => ({
  version: 't', generatedAt: Date.now(), tz: 'UTC', intervalMs: 1000, billingIntervalMs: 60_000,
  providers: [{ id: 'claude', name: 'Claude', color: 'green' }, { id: 'codex', name: 'Codex', color: 'cyan' }],
  accounts, seeded: true, peak: null,
})

const config: Config = { ...DEFAULTS, tray: { ...DEFAULTS.tray, activeTimeoutMin: 10 } }

function renderCard(snap: WebSnapshot, expanded: boolean, pinned = false, cardConfig = config): string {
  const group = groupByProvider(snap)[0]!
  return renderToStaticMarkup(createElement(ProviderCard, {
    group, snapshot: snap, config: cardConfig, pinned, pinPosition: pinned ? 1 : null, pinCount: pinned ? 1 : 0,
    expanded, deny: false, refreshing: false,
    now: Date.now(), onToggle: () => {}, onPin: () => {}, onArrow: () => {}, onRemoveAccount: () => {},
  }))
}

test('a collapsed provider card is a disclosure button with the representative value, detail hidden', () => {
  const html = renderCard(snapshot([account({
    billing: { plan: 'Pro', metrics: [metric({ label: 'Session', used: 42, primary: true }), metric({ label: 'Weekly usage', used: 30 })], error: null },
  })]), false)
  assert.match(html, /Claude/)
  assert.match(html, /aria-expanded="false"/)
  assert.match(html, /42% used/) // representative floor is Session; presentation is consumed usage
  assert.match(html, /Resets in 3h 25m/)
  assert.doesNotMatch(html, /class="meter"/) // collapsed: no expanded meter rows
  assert.doesNotMatch(html, /!/) // never a cryptic prefix
})

test('provider usage lockup renders the authentic mark and numeral with no radial gauge', () => {
  for (const providerId of ['claude', 'codex', 'cursor']) {
    const html = renderCard(snapshot([account({
      id: providerId, providerId: providerId as WebAccount['providerId'],
      billing: { plan: 'Pro', metrics: [metric({ used: 42, primary: true })], error: null },
    })]), false)
    const mark = providerMark(providerId)
    assert.ok(mark && html.includes(mark.path), `${providerId} mark is present`)
    assert.match(html, /class="chip"/)
    assert.match(html, /class="chip-num"[^>]*>42</)
    assert.match(html, /class="chip-bar"/)
    assert.doesNotMatch(html, /class="ring|class="seg|<line/)
  }
})

test('an expanded card reveals every account window as meters and marks aria-expanded', () => {
  const html = renderCard(snapshot([account({
    billing: { plan: 'Pro', metrics: [metric({ label: 'Session', used: 42, primary: true }), metric({ label: 'Weekly usage', used: 30 })], error: null },
  })]), true)
  assert.match(html, /aria-expanded="true"/)
  assert.match(html, /class="meter"/)
  assert.match(html, /Session/)
  assert.match(html, /Weekly/)
  assert.match(html, /30% used/) // the second window now visible (no 2-row cap)
  assert.doesNotMatch(html, /% left|percent remaining/)
})

test('canonical provider stats aggregate once above accounts with compact billion-token values', () => {
  const html = renderCard(snapshot([
    account({
      id: 'one', email: 'one@example.com',
      dashboard: dashboard({
        today: usage({ cost: 400, tokens: 500_000_000, cacheRead: 480_000_000 }),
        week: usage({ cost: 1_000, tokens: 1_500_000_000, cacheRead: 1_440_000_000 }),
        month: usage({ cost: 7_000, tokens: 10_000_000_000, cacheRead: 9_600_000_000, cacheSavings: 30_000 }),
        burnRate: 30,
        series: [...Array.from({ length: 10 }, () => 0), 0, 1, 2, 4],
      }),
    }),
    account({
      id: 'two', email: 'two@example.com',
      dashboard: dashboard({
        today: usage({ cost: 24.76, tokens: 82_330_000, cacheRead: 80_000_000 }),
        week: usage({ cost: 304.74, tokens: 320_000_000, cacheRead: 307_200_000 }),
        month: usage({ cost: 1_930.28, tokens: 2_250_000_000, cacheRead: 2_160_000_000, cacheSavings: 23_000 }),
        burnRate: 4.11,
        series: [...Array.from({ length: 10 }, () => 0), 2, 0, 3, 1],
      }),
    }),
  ]), true)

  assert.equal(html.match(/class="provider-usage-stats"/g)?.length, 1)
  assert.match(html, /aria-label="Claude token usage and spend"/)
  assert.match(html, /data-period="today"[\s\S]*\$424\.76[\s\S]*582\.33M tokens[\s\S]*96% cached/)
  assert.match(html, /data-period="week"[\s\S]*\$1,304\.74[\s\S]*1\.82B tokens[\s\S]*96% cached/)
  assert.match(html, /data-period="month"[\s\S]*\$8,930\.28[\s\S]*12\.25B tokens[\s\S]*96% cached/)
  assert.match(html, /Burn[\s\S]*\$34\.11\/hr/)
  assert.match(html, /Cache saved[\s\S]*\$53\.0k\/mo/)
  assert.match(html, /aria-label="Claude 14-day spend activity"/)
  assert.match(html, /\$8,930\.28\/mo/)
  assert.equal(html.match(/class="usage-spark"/g)?.length, 1)
  assert.ok(html.indexOf('provider-usage-stats') < html.indexOf('account-block'))
})

test('desktop graph range slices the daemon history and labels the selected period', () => {
  const snap = snapshot([account({
    dashboard: dashboard({
      today: usage({ cost: 1, tokens: 10 }),
      series: Array.from({ length: 30 }, (_, index) => index + 1),
    }),
  })])
  for (const rangeDays of [7, 30] as const) {
    const html = renderCard(snap, true, false, {
      ...config,
      desktop: { ...config.desktop, graphRangeDays: rangeDays },
    })
    assert.match(html, new RegExp(`aria-label="Claude ${rangeDays}-day spend activity"`))
    const points = html.match(/<polyline points="([^"]+)"/)?.[1]?.split(' ') ?? []
    assert.equal(points.length, rangeDays)
  }
})

test('desktop graph range stays truthful for cached history and can reveal prior-month spend', () => {
  const cached = snapshot([account({
    dashboard: dashboard({
      today: usage({ cost: 1 }),
      series: Array.from({ length: 14 }, (_, index) => index + 1),
    }),
  })])
  const cachedHtml = renderCard(cached, true, false, {
    ...config,
    desktop: { ...config.desktop, graphRangeDays: 30 },
  })
  assert.match(cachedHtml, /aria-label="Claude 14-day spend activity"/)

  const priorMonth = snapshot([account({
    dashboard: dashboard({ series: [1, ...Array.from({ length: 29 }, () => 0)] }),
  })])
  const fourteen = renderCard(priorMonth, true, false, {
    ...config,
    desktop: { ...config.desktop, graphRangeDays: 14 },
  })
  const thirty = renderCard(priorMonth, true, false, {
    ...config,
    desktop: { ...config.desktop, graphRangeDays: 30 },
  })
  assert.doesNotMatch(fourteen, /provider-usage-stats/)
  assert.match(thirty, /aria-label="Claude 30-day spend activity"/)
})

test('provider stats stay out of collapsed, missing, and real-zero states', () => {
  const nonzero = account({ dashboard: dashboard({ today: usage({ cost: 1, tokens: 10 }) }) })
  assert.doesNotMatch(renderCard(snapshot([nonzero]), false), /provider-usage-stats|data-period="today"/)
  assert.doesNotMatch(renderCard(snapshot([account({ dashboard: null })]), true), /provider-usage-stats/)
  assert.doesNotMatch(renderCard(snapshot([account({
    dashboard: dashboard({ burnRate: 5, series: [0, 0], month: usage({ cacheSavings: 9 }) }),
  })]), true), /provider-usage-stats/)
})

test('zero cache percentage leaves the compact cached column blank without NaN', () => {
  const html = renderCard(snapshot([account({
    dashboard: dashboard({ today: usage({ cost: 1, tokens: 10, cacheRead: 0 }) }),
  })]), true)
  assert.match(html, /class="provider-usage-stats"/)
  assert.doesNotMatch(html, /cached|NaN|Infinity/)
})

test('provider stats disclose partial and stale aggregates instead of presenting them as complete', () => {
  const partial = renderCard(snapshot([
    account({ id: 'ready', dashboard: dashboard({ today: usage({ cost: 1, tokens: 10 }) }) }),
    account({ id: 'failed', dashboard: null, summaryState: 'error' }),
  ]), true)
  assert.match(partial, /Partial usage data · refresh failed/)

  const old = Date.now() - 600_000
  const stale = renderCard(snapshot([account({
    dashboard: dashboard({ today: usage({ cost: 1, tokens: 10 }) }),
    summaryUpdatedAt: old,
  })]), true)
  assert.match(stale, /Usage data may be outdated/)
})

test('daemon-headroom disclosure labels announce provider refresh errors', () => {
  const snap = snapshot([account({ billingState: 'error' })])
  snap.providers[0]!.headroom = {
    value: 80,
    unit: 'index-100',
    mode: 'single-window',
    basis: 'idle-runway',
    representativeAccountId: 'a',
    activeAccountIds: [],
    factors: [],
    explanation: 'Session',
  }
  const html = renderCard(snap, false)
  assert.match(html, /aria-label="Claude, Usage 20%, [^"]*data may be outdated, could not refresh, collapsed"/)
})

test('expanded rows preserve provider source order instead of sorting by remaining quota', () => {
  const html = renderCard(snapshot([account({
    billing: { plan: 'Pro', metrics: [
      metric({ label: 'Session', used: 2 }),
      metric({ label: 'Weekly', used: 62 }),
      metric({ label: 'Fable', used: 100 }),
    ], error: null },
  })]), true)
  assert.match(html, /class="row-label">Session<\/span>[\s\S]*class="row-label">Weekly<\/span>[\s\S]*class="row-label">Fable<\/span>/)
})

test('warn and critical severities render their mandatory text tags, never "!"', () => {
  const warn = renderCard(snapshot([account({ billing: { plan: 'Pro', metrics: [metric({ used: 80 })], error: null } })]), false)
  assert.match(warn, /High/)
  assert.doesNotMatch(warn, /!/)
  const crit = renderCard(snapshot([account({ billing: { plan: 'Pro', metrics: [metric({ used: 95 })], error: null } })]), false)
  assert.match(crit, /Very high/)
  assert.doesNotMatch(crit, /!/)
})

test('a multi-account provider expands to both identities and Active, one card', () => {
  const html = renderCard(snapshot([
    account({ id: 'c1', email: 'work@acme.com', plan: 'Pro', lastActivityAt: Date.now() }),
    account({ id: 'c2', email: 'home@acme.com', plan: 'Max' }),
  ]), true)
  assert.equal(html.match(/class="account-identity">\[redacted\]/g)?.length, 2)
  assert.doesNotMatch(html, /@acme\.com/)
  assert.match(html, /Active/)
  assert.equal(html.match(/class="provider-card[^"]*"/g)?.length, 1)
})

test('detected accounts expose a direct, recoverable remove action', () => {
  const html = renderCard(snapshot([
    account({ id: 'a', source: 'auto', identity: { title: 'Claude account 1', subtitle: null, accessibleLabel: 'Claude account 1', redacted: true } }),
    account({ id: 'b', source: 'auto', identity: { title: 'Claude account 2', subtitle: null, accessibleLabel: 'Claude account 2', redacted: true } }),
  ]), true)
  assert.match(html, /aria-label="Remove Claude account 1 from Tokmon"/)
  assert.match(html, /aria-label="Remove Claude account 2 from Tokmon"/)
})

test('provider domain errors remain visible when the fetch itself completed', () => {
  const html = renderCard(snapshot([
    account({
      source: 'auto',
      billingState: 'ready',
      billing: { plan: null, metrics: [], error: 'This Claude home is logged out.' },
    }),
  ]), true)
  assert.match(html, /This Claude home is logged out\./)
  assert.doesNotMatch(html, />No data</)
})

test('optimistic account policy removes only the selected detected home', () => {
  const original = snapshot([
    account({ id: 'default', source: 'auto', homeDir: null }),
    account({ id: 'other', source: 'auto', homeDir: '/tmp/claude-other' }),
  ])
  original.providers[0]!.headroom = {
    value: 55, unit: 'index-100', mode: 'single-window', basis: 'idle-runway',
    representativeAccountId: 'other', activeAccountIds: [], factors: [], explanation: 'test',
  }
  const filtered = snapshotWithAccountPolicy(original, {
    ...config,
    accountDetection: {
      ...config.accountDetection,
      excludedAccounts: [{ providerId: 'claude', homeDir: '/tmp/claude-other' }],
    },
  })
  assert.deepEqual(filtered.accounts.map(value => value.id), ['default'])
  assert.equal(filtered.providers[0]?.headroom, undefined)
})

test('optimistic account policy overlays tracking, discovery, and manual enabled intent', () => {
  const original = snapshot([
    account({ id: 'auto', source: 'auto', homeDir: null }),
    account({ id: 'manual', source: 'configured', homeDir: '/tmp/manual' }),
  ])
  const manualConfig = {
    id: 'manual',
    providerId: 'claude' as const,
    name: 'Manual',
    homeDir: '/tmp/manual',
  }

  assert.deepEqual(snapshotWithAccountPolicy(original, {
    ...config,
    accounts: [manualConfig],
    accountDetection: { ...config.accountDetection, enabled: false },
  }).accounts.map(value => value.id), ['manual'])
  assert.deepEqual(snapshotWithAccountPolicy(original, {
    ...config,
    accounts: [{ ...manualConfig, enabled: false }],
  }).accounts.map(value => value.id), ['auto'])
  assert.deepEqual(snapshotWithAccountPolicy(original, {
    ...config,
    accounts: [manualConfig],
    disabledProviders: ['claude'],
  }).accounts, [])
})

test('desktop account labels are email-only even when daemon titles contain provider names and commas', () => {
  const visible = { ...config, privacyMode: false } as Config
  const makeComposite = (id: string, email: string, displayName: string): WebAccount => account({
    id, name: `Claude ${email}`, email, displayName,
    identity: {
      title: `Claude ${email}`, subtitle: displayName,
      accessibleLabel: `Claude ${email}, ${displayName}`, redacted: false,
    },
  })
  const snap = snapshot([
    makeComposite('c1', 'david@davidilie.com', 'David'),
    makeComposite('c2', 'david@davidapps.dev', 'David'),
    makeComposite('c3', 'maximilian.bostan@gmail.com', 'Max'),
  ])
  const expanded = renderCard(snap, true, false, visible)
  const labels = [...expanded.matchAll(/class="account-identity">([^<]+)</g)].map(match => match[1])

  assert.deepEqual(labels, ['david@davidilie.com', 'david@davidapps.dev', 'maximilian.bostan@gmail.com'])
  assert.doesNotMatch(expanded, /class="account-identity">[^<]*(?:Claude|, David|, Max)/)

  const single = renderCard(snapshot([makeComposite('c1', 'david@davidilie.com', 'David')]), false, false, visible)
  assert.doesNotMatch(single, /david@davidilie\.com/)
  assert.doesNotMatch(single, /Claude account 1|Codex account 1/)
})

test('collapsed multi-account shows an honest secondary summary only when expanded', () => {
  const snap = snapshot([
    account({ id: 'c1', email: 'work@acme.com', lastActivityAt: Date.now(), billing: { plan: 'Max', metrics: [metric({ label: 'Fable', used: 93 })], error: null } }),
    account({ id: 'c2', email: 'home@acme.com', billing: { plan: 'Max', metrics: [metric({ label: 'Weekly', used: 31 })], error: null } }),
  ])
  assert.doesNotMatch(renderCard(snap, false), /highest usage/) // Layer 1 stays scannable
  assert.match(renderCard(snap, true), /highest usage 93% · lowest usage 31%/)
})

test('an uncapped spend metric renders value-only with no NaN and no meter', () => {
  const html = renderCard(snapshot([account({
    billing: { plan: 'Pro', metrics: [metric({ label: 'Spend', used: 1.2, limit: null, format: { kind: 'dollars' } })], error: null },
  })]), true)
  assert.doesNotMatch(html, /NaN/)
  assert.match(html, /\$1\.20/)
})

test('the footer exposes a refresh target and a labelled Open Dashboard action', () => {
  const html = renderToStaticMarkup(createElement(Footer, {
    snapshot: snapshot([account({})]), refreshing: false, now: Date.now(),
    appName: 'Tokmon', appVersion: '0.28.2', daemon: {
      role: 'owner', ownerKind: 'desktop', version: '0.28.2', protocolVersion: 4, channel: 'release',
    },
    onRefresh: () => {}, onSettings: () => {}, onDashboard: () => {},
  }))
  assert.match(html, /Open Dashboard/)
  assert.match(html, /Updated/)
  assert.match(html, /Tokmon 0\.28\.2/)
  assert.match(html, /aria-label="Tokmon version 0\.28\.2, Background service 0\.28\.2 · protocol 4 · this app"/)
})

test('the footer ages its timestamp on the shared formatAgo cutoffs', () => {
  const now = Date.now()
  const footer = (generatedAt: number): string => renderToStaticMarkup(createElement(Footer, {
    snapshot: { ...snapshot([account({})]), generatedAt }, refreshing: false, now,
    appName: 'Tokmon', appVersion: '0.28.2', daemon: null,
    onRefresh: () => {}, onSettings: () => {}, onDashboard: () => {},
  }))
  assert.match(footer(now - 1_000), /Updated just now/)
  assert.match(footer(now - 5_000), /Updated 5s ago/)
  assert.match(footer(now - 90_000), /Updated 2m ago/)
  assert.match(footer(now - 2 * 24 * 3_600_000), /Updated 2d ago/)
})

test('the footer identifies a compatible CLI-owned background service', () => {
  const html = renderToStaticMarkup(createElement(Footer, {
    snapshot: snapshot([account({})]), refreshing: false, now: Date.now(),
    appName: 'Tokmon', appVersion: '0.28.5', daemon: {
      role: 'attached', ownerKind: 'cli', version: '0.28.6', protocolVersion: 4, channel: 'release',
    },
    onRefresh: () => {}, onSettings: () => {}, onDashboard: () => {},
  }))

  assert.match(html, /Tokmon 0\.28\.5 · CLI service/)
  assert.match(html, /Background service 0\.28\.6 · protocol 4 · CLI/)
})

test('a downloaded update earns one explicit restart action above the quiet version footer', () => {
  const html = renderToStaticMarkup(createElement(UpdateReady, {
    update: { status: 'downloaded', availableVersion: '0.29.0', progressPercent: 100, error: null },
    currentVersion: '0.28.3', onInstall: () => {},
  }))

  assert.match(html, /Tokmon 0\.29\.0 is ready/)
  assert.match(html, /Current version 0\.28\.3/)
  assert.match(html, />Restart to Install</)
  assert.equal(renderToStaticMarkup(createElement(UpdateReady, {
    update: { status: 'idle', availableVersion: null, progressPercent: null, error: null },
    currentVersion: '0.28.3', onInstall: () => {},
  })), '')
})

test('update chrome communicates download progress and disables duplicate restart clicks', () => {
  const downloading = renderToStaticMarkup(createElement(UpdateReady, {
    update: { status: 'downloading', availableVersion: '0.29.0', progressPercent: 42, error: null },
    currentVersion: '0.28.7', onInstall: () => {},
  }))
  assert.match(downloading, /Downloading Tokmon 0\.29\.0/)
  assert.match(downloading, /42%/)
  assert.match(downloading, /role="progressbar"/)
  assert.doesNotMatch(downloading, /Restart to Install/)

  const restarting = renderToStaticMarkup(createElement(UpdateReady, {
    update: { status: 'restarting', availableVersion: '0.29.0', progressPercent: 100, error: null },
    currentVersion: '0.28.7', onInstall: () => {},
  }))
  assert.match(restarting, /Restarting to install Tokmon 0\.29\.0/)
  assert.match(restarting, /Closing the background service safely/)
  assert.doesNotMatch(restarting, /<button/)

  const failed = renderToStaticMarkup(createElement(UpdateReady, {
    update: { status: 'error', availableVersion: '0.29.0', progressPercent: null, error: 'Native installer rejected the update' },
    currentVersion: '0.28.7', onInstall: () => {}, onCheck: () => {},
  }))
  assert.match(failed, /Update couldn’t finish/)
  assert.match(failed, /Native installer rejected the update/)
  assert.match(failed, /Check Again/)
  assert.match(failed, /role="alert"/)
})

test('cross-provider totals render one quiet canonical strip with honest partial state', () => {
  const now = Date.now()
  const html = renderToStaticMarkup(createElement(TotalsBar, {
    snapshot: snapshot([
      account({
        id: 'one', dashboard: dashboard({
          today: usage({ cost: 400, tokens: 500_000_000 }),
          week: usage({ cost: 1_000, tokens: 1_500_000_000 }),
          month: usage({ cost: 7_000, tokens: 10_000_000_000 }),
        }),
      }),
      account({
        id: 'two', providerId: 'codex', dashboard: dashboard({
          today: usage({ cost: 24.76, tokens: 82_330_000 }),
          week: usage({ cost: 304.74, tokens: 320_000_000 }),
          month: usage({ cost: 1_930.28, tokens: 2_250_000_000 }),
        }),
      }),
    ]),
    now,
  }))
  assert.match(html, /Total today \$424\.76 · 582\.33M tokens/)
  assert.match(html, /Month \$8,930\.28/)
  assert.match(html, /This week \$1,304\.74 · 1\.82B tokens/)

  const partial = renderToStaticMarkup(createElement(TotalsBar, {
    snapshot: snapshot([
      account({ dashboard: dashboard({ today: usage({ cost: 1, tokens: 2 }) }) }),
      account({ id: 'missing', providerId: 'codex', dashboard: null }),
    ]),
    now,
  }))
  assert.match(partial, /data-state="partial"/)
  assert.match(partial, />Partial</)
})

test('popover measurement includes totals, update state and footer chrome', () => {
  assert.equal(measuredPopoverHeight(480.2, [28, 52, 58]), 619)
})

test('desktop settings keeps app behavior while menu bar composition lives elsewhere', () => {
  const snap = snapshot([account({})])
  const fullConfig = {
    ...config,
    privacyToggleKey: 'p',
    tray: {
      ...config.tray,
      displayMetric: 'smartHeadroom', pinnedProviders: ['claude'], showMenuBarText: true,
      launchAtLogin: false, activeTimeoutMin: 10,
    },
    desktop: { ...config.desktop, expandedProviders: ['claude'] },
  } as Config
  const html = renderToStaticMarkup(createElement(DesktopSettings, {
    config: fullConfig,
    update: { status: 'idle', availableVersion: null, progressPercent: null, error: null },
    loginItem: { status: 'disabled', enabled: false, error: null },
    appVersion: '0.28.5',
    daemon: {
      role: 'attached', ownerKind: 'cli', version: '0.28.7', protocolVersion: 4, channel: 'release',
    },
    onPatch: () => {}, onBack: () => {}, onDashboard: () => {},
    onCheckUpdates: () => {}, onQuit: () => {},
  }))
  assert.match(html, /Privacy mode/)
  assert.match(html, /Provider summary/)
  assert.match(html, /role="radiogroup" aria-label="Provider summary"/)
  assert.doesNotMatch(html, /Expanded by default|Providers expanded by default/)
  assert.doesNotMatch(html, /Pinned providers|Menu bar text|Menu bar value/)
  assert.match(html, /Graph range/)
  assert.match(html, />7d<\/button>/)
  assert.match(html, /data-active="true">14d<\/button>/)
  assert.match(html, />30d<\/button>/)
  assert.match(html, /Launch at login/)
  assert.match(html, /Start Tokmon silently after sign-in/)
  assert.match(html, /Tokmon 0\.28\.5/)
  assert.match(html, /Background service 0\.28\.7 · protocol 4 · CLI/)
  assert.match(html, /Check for Updates/)
  assert.match(html, /Quit Tokmon/)
  assert.match(html, /Manage all settings/)
})

test('desktop settings is truthful when the package manager owns Linux updates', () => {
  const snap = snapshot([account({})])
  const html = renderToStaticMarkup(createElement(DesktopSettings, {
    config,
    update: { status: 'unsupported', availableVersion: null, progressPercent: null, error: null },
    loginItem: { status: 'unsupported', enabled: false, error: null },
    appVersion: '0.28.7', daemon: null,
    onPatch: () => {}, onBack: () => {}, onDashboard: () => {},
    onCheckUpdates: () => {}, onQuit: () => {},
  }))
  assert.match(html, /managed by your package manager/)
  assert.match(html, /disabled=""[^>]*>Use Package Manager/)
})

test('desktop settings defers a downloaded update to the global restart action', () => {
  const snap = snapshot([account({})])
  const html = renderToStaticMarkup(createElement(DesktopSettings, {
    config,
    update: { status: 'downloaded', availableVersion: '0.29.0', progressPercent: 100, error: null },
    loginItem: { status: 'enabled', enabled: true, error: null },
    appVersion: '0.28.5',
    daemon: null,
    onPatch: () => {}, onBack: () => {}, onDashboard: () => {},
    onCheckUpdates: () => {}, onQuit: () => {},
  }))
  assert.match(html, /0\.29\.0 is ready to install/)
  assert.match(html, /disabled=""[^>]*>Update Ready/)
})

test('desktop settings explains when macOS still requires login item approval', () => {
  const pendingConfig = {
    ...config,
    tray: { ...config.tray, launchAtLogin: true },
  } as Config
  const html = renderToStaticMarkup(createElement(DesktopSettings, {
    config: pendingConfig,
    update: { status: 'idle', availableVersion: null, progressPercent: null, error: null },
    loginItem: { status: 'requires-approval', enabled: false, error: null },
    appVersion: '0.29.4', daemon: null,
    onPatch: () => {}, onBack: () => {}, onDashboard: () => {},
    onCheckUpdates: () => {}, onQuit: () => {},
  }))
  assert.match(html, /Allow Tokmon in System Settings → General → Login Items/)
  assert.match(html, /role="switch" aria-checked="true"/)
})

test('settings hub orders theme, menu bar, providers, then desktop behavior', () => {
  const fullConfig = {
    ...config,
    appearance: { version: 1, mode: 'auto', preset: 'tokmon', terminal: 'ansi' },
  } as Config
  const html = renderToStaticMarkup(createElement(SettingsHub, {
    config: fullConfig, onBack: () => {}, onTheme: () => {}, onMenuBar: () => {},
    onProviders: () => {}, onDesktop: () => {},
  }))

  assert.match(html, /aria-label="Settings sections"/)
  assert.match(html, />Theme</)
  assert.match(html, /Tokmon · Auto/)
  assert.match(html, />Menu Bar</)
  assert.match(html, /Content, spacing, and compact screens/)
  assert.match(html, /Providers &amp; Accounts/)
  assert.match(html, />Desktop App</)
  assert.ok(html.indexOf('>Theme<') < html.indexOf('>Menu Bar<'))
  assert.ok(html.indexOf('>Menu Bar<') < html.indexOf('>Providers &amp; Accounts<'))
  assert.ok(html.indexOf('>Providers &amp; Accounts<') < html.indexOf('>Desktop App<'))
})

test('providers and accounts separates global tracking from discovery controls', () => {
  const fullConfig: Config = {
    ...config,
    privacyMode: false,
    disabledProviders: ['codex'],
    accountDetection: {
      enabled: true,
      disabledProviders: ['codex'],
      excludedAccounts: [{ providerId: 'claude', homeDir: '/tmp/old-claude' }],
    },
  }
  const html = renderToStaticMarkup(createElement(ProvidersSettings, {
    config: fullConfig,
    snapshot: snapshot([account({ id: 'claude-alt', homeDir: '/tmp/claude-alt' })]),
    onPatch: () => {}, onBack: () => {}, onDashboard: () => {},
  }))
  assert.match(html, /Track these providers/)
  assert.match(html, /Turn a provider off everywhere without deleting its accounts, pins, or card preferences/)
  assert.match(html, /aria-label="Track Claude"/)
  assert.match(html, /aria-checked="false" aria-label="Track Codex"/)
  assert.match(html, /Automatic discovery/)
  assert.match(html, /Discover accounts/)
  assert.match(html, /Provider detectors/)
  assert.match(html, /role="group" aria-label="Provider detectors"/)
  assert.match(html, /aria-pressed="false"[^>]*>Codex</)
  assert.ok(html.includes('/tmp/claude-alt'))
  assert.ok(html.includes('/tmp/old-claude'))
  assert.match(html, /Accounts on this computer/)
  assert.match(html, /without changing its provider files, login, or the other accounts/)
  assert.match(html, />Remove</)
  assert.match(html, />Restore</)
  assert.match(html, /Turning this off hides every detected account/)
})

test('provider pin segment reserves its ordinal and announces the menu bar position', () => {
  const pinned = renderCard(snapshot([account({})]), false, true)
  assert.match(pinned, /class="pin"[^>]*aria-pressed="true"/)
  assert.match(pinned, /aria-label="Unpin Claude from position 1 in the menu bar"/)
  assert.match(pinned, /class="pin-position"[^>]*>1</)

  const unpinned = renderCard(snapshot([account({})]), false, false)
  assert.match(unpinned, /aria-label="Pin Claude to position 1 in the menu bar"/)
  assert.match(unpinned, /class="pin-position"[^>]*><\/span>/)
})

test('Option pinning replaces position two without reordering the first provider', () => {
  assert.deepEqual(pinProviderFromCard(['claude', 'codex'], 'cursor', true), {
    pins: ['claude', 'cursor'], rejected: false, replaced: true,
  })
  assert.equal(pinProviderFromCard(['claude', 'codex'], 'cursor').rejected, true)
  assert.deepEqual(pinProviderFromCard(['claude'], 'codex').pins, ['claude', 'codex'])
})

test('pin writes preserve providers absent from the live snapshot', () => {
  assert.deepEqual(
    pinProviderPreservingStoredPins(['claude', 'codex'], ['codex'], 'cursor'),
    { pins: ['claude', 'codex'], rejected: true, replaced: false },
  )
  assert.deepEqual(
    pinProviderPreservingStoredPins(['claude', 'codex'], ['codex'], 'cursor', true),
    { pins: ['claude', 'cursor'], rejected: false, replaced: true },
  )
  assert.deepEqual(
    pinProviderPreservingStoredPins(['claude', 'codex'], ['codex'], 'codex'),
    { pins: ['claude'], rejected: false, replaced: false },
  )
})

test('menu bar builder exposes production controls, exact spacing copy, and a truthful empty preview', () => {
  const html = renderToStaticMarkup(createElement(MenuBarSettings, {
    config,
    snapshot: snapshot([account({})]),
    pins: [],
    platform: 'darwin',
    displayWidthPt: 1440,
    update: { status: 'idle', availableVersion: null, progressPercent: null, error: null },
    onPatch: () => {}, onBack: () => {}, onToast: () => {},
  }))
  assert.match(html, /aria-label="Live menu bar preview"/)
  assert.match(html, /Pin a provider from Usage/)
  assert.match(html, /class="menubar-preview-native"/)
  assert.match(html, /--menubar-native-inset:10px/)
  assert.match(html, /Highlighted pill includes macOS’s 10 pt inset on each side\. Brackets mark Tokmon content\./)
  assert.match(html, /role="radiogroup" aria-label="Menu bar layout mode"/)
  assert.match(html, /role="radio" aria-checked="true" data-active="true">Auto</)
  assert.match(html, />Auto<\/button>/)
  assert.match(html, />Custom<\/button>/)
  assert.match(html, /Show provider mark/)
  assert.match(html, /Show value/)
  assert.match(html, /Show progress/)
  assert.match(html, /Menu bar content/)
  assert.match(html, /Tokens today/)
  assert.match(html, />Comfortable<\/button>/)
  assert.match(html, />Compact<\/button>/)
  assert.match(html, />Tight<\/button>/)
  assert.match(html, /Reset Menu Bar/)

  const customConfig = patchMenuBarPresentation(config, { mode: 'custom' })
  const customHtml = renderToStaticMarkup(createElement(MenuBarSettings, {
    config: customConfig, snapshot: snapshot([account({})]), pins: [], platform: 'win32',
    displayWidthPt: 1280,
    update: { status: 'idle', availableVersion: null, progressPercent: null, error: null },
    onPatch: () => {}, onBack: () => {}, onToast: () => {},
  }))
  assert.match(customHtml, /The composed strip is a macOS feature/)
  assert.match(customHtml, /Custom menu bar spacing/)
  assert.match(customHtml, />Edge</)
  assert.match(customHtml, />Mark to value</)
  assert.match(customHtml, />Between providers</)
  assert.match(customHtml, /1\.0 pt/)
  assert.match(customHtml, /3\.0 pt/)
  assert.match(customHtml, /8\.0 pt/)
})

test('menu bar element updates mirror legacy value state and prevent an invisible strip', () => {
  const withoutValue = setMenuBarElementVisibility(config, 'value', false)
  assert.equal(withoutValue.tray.menuBar.elements.value, false)
  assert.equal(withoutValue.tray.showMenuBarText, false)

  const markOnly: Config = {
    ...config,
    tray: {
      ...config.tray,
      menuBar: {
        ...config.tray.menuBar,
        elements: { providerMark: true, value: false, progress: false },
      },
      showMenuBarText: false,
    },
  }
  assert.equal(setMenuBarElementVisibility(markOnly, 'providerMark', false), markOnly)
  const html = renderToStaticMarkup(createElement(MenuBarSettings, {
    config: markOnly, snapshot: snapshot([account({})]), pins: [], platform: 'darwin',
    displayWidthPt: 1440,
    update: { status: 'idle', availableVersion: null, progressPercent: null, error: null },
    onPatch: () => {}, onBack: () => {}, onToast: () => {},
  }))
  assert.match(html, /aria-label="Show provider mark" disabled=""/)
})

test('menu bar builder patches mode, density, custom spacing, and value without losing sibling fields', () => {
  const custom = patchMenuBarPresentation(config, { mode: 'custom', density: 'tight' })
  assert.equal(custom.tray.menuBar.mode, 'custom')
  assert.equal(custom.tray.menuBar.density, 'tight')
  assert.deepEqual(custom.tray.menuBar.elements, config.tray.menuBar.elements)

  const spaced = patchMenuBarPresentation(custom, { customSpacing: { edgePaddingPt: 2.5 } })
  assert.equal(spaced.tray.menuBar.customSpacing.edgePaddingPt, 2.5)
  assert.equal(spaced.tray.menuBar.customSpacing.markValueGapPt, config.tray.menuBar.customSpacing.markValueGapPt)
  assert.equal(spaced.tray.menuBar.customSpacing.providerGapPt, config.tray.menuBar.customSpacing.providerGapPt)

  const tokens = setMenuBarValue(spaced, 'todayTokens')
  assert.equal(tokens.tray.menuBarValue, 'todayTokens')
  assert.deepEqual(tokens.tray.menuBar, spaced.tray.menuBar)
})

test('resetting menu bar presentation preserves pins and the selected value', () => {
  const custom: Config = {
    ...config,
    tray: {
      ...config.tray,
      pinnedProviders: ['claude', 'codex'],
      menuBarValue: 'todayTokens',
      menuBar: {
        ...config.tray.menuBar,
        mode: 'custom', density: 'tight',
        elements: { providerMark: false, value: false, progress: true },
        customSpacing: { edgePaddingPt: 6, markValueGapPt: 8, providerGapPt: 16 },
      },
      showMenuBarText: false,
    },
  }
  const reset = resetMenuBarPresentation(custom)
  assert.deepEqual(reset.tray.menuBar, DEFAULTS.tray.menuBar)
  assert.deepEqual(reset.tray.pinnedProviders, ['claude', 'codex'])
  assert.equal(reset.tray.menuBarValue, 'todayTokens')
  assert.equal(reset.tray.showMenuBarText, true)

  // Nested blocks must be fresh copies, never aliases of the shared defaults.
  const again = resetMenuBarPresentation(custom)
  assert.notEqual(reset.tray.menuBar.elements, again.tray.menuBar.elements)
  assert.notEqual(reset.tray.menuBar.customSpacing, again.tray.menuBar.customSpacing)
  assert.notEqual(reset.tray.menuBar.elements, DEFAULTS.tray.menuBar.elements)
})

test('compact theme page exposes the shared catalog while keeping Phosphor dark-only', () => {
  const fullConfig = {
    ...config,
    appearance: { version: 1, mode: 'auto', preset: 'phosphor', terminal: 'ansi' },
  } as Config
  const html = renderToStaticMarkup(createElement(ThemeSettings, {
    config: fullConfig, systemMode: 'light', onPatch: () => {}, onBack: () => {}, onDashboard: () => {},
  }))

  assert.match(html, /aria-label="Appearance mode"/)
  assert.match(html, /Auto is currently light/)
  assert.match(html, /disabled=""[^>]*>Auto</)
  assert.match(html, /disabled=""[^>]*>Light</)
  assert.match(html, /data-active="true"[^>]*>Dark</)
  assert.match(html, /role="radiogroup"/)
  assert.match(html, /aria-checked="true"[^>]*data-active="true"[^>]*data-preset="phosphor"/)
  assert.match(html, /Phosphor stays dark/)
  assert.match(html, />Monokai</)
  assert.match(html, />Dracula</)
  assert.match(html, />Tokyo Night</)
  assert.match(html, /Customize Phosphor in Dashboard/)
})

test('the Custom theme tile commits the palette it previews, whatever preset you came from', () => {
  const fromDracula = {
    ...config,
    appearance: { version: 1, mode: 'dark', preset: 'dracula', terminal: 'ansi' },
  } as Config

  // The tile paints resolveTheme({...appearance, preset:'custom'}), which falls back to
  // custom?.base ?? 'tokmon'. Selecting it must persist an appearance that resolves the
  // same way — seeding a base from the outgoing preset advertised the wrong palette.
  const previewed = resolveTheme({ ...fromDracula.appearance, preset: 'custom' }, 'dark').tokens.panel
  const selected = applyThemePreset(fromDracula, 'custom')
  const committed = resolveTheme(repairAppearance(selected.appearance).appearance, 'dark').tokens.panel
  assert.equal(committed, previewed)
  assert.equal(selected.appearance.custom, undefined)

  // Dark-only presets still force the mode; ordinary ones leave it alone.
  assert.equal(applyThemePreset(fromDracula, 'phosphor').appearance.mode, 'dark')
  const fromAuto = { ...config, appearance: { ...fromDracula.appearance, mode: 'auto' } } as Config
  assert.equal(applyThemePreset(fromAuto, 'monokai').appearance.mode, 'auto')
})

test('daemon headroom replaces the old local representative in the card headline', () => {
  const snap = snapshot([account({
    identity: { title: 'Claude account 1', subtitle: null, accessibleLabel: 'Claude account 1', redacted: true },
  })])
  snap.providers[0]!.headroom = {
    value: 38, unit: 'index-100', mode: 'smart', basis: 'active', representativeAccountId: 'a', activeAccountIds: ['a'],
    factors: [{ key: 'session', label: 'Session', role: 'session', remainingPct: 98, included: true, reason: 'session' }, { key: 'weekly', label: 'Weekly', role: 'weekly', remainingPct: 38, included: true, reason: 'weekly-cap' }],
    explanation: 'Based on Session + Weekly; active account',
  }
  const html = renderCard(snap, false)
  assert.match(html, /Usage 62%/)
  assert.doesNotMatch(html, /Headroom|% left|Based on|Session \+ Weekly/)
  assert.doesNotMatch(html, /Claude account 1/)
})

test('single default instances omit redundant account labels while multiple accounts stay identifiable', () => {
  const single = renderCard(snapshot([account({
    identity: { title: 'Claude account 1', subtitle: null, accessibleLabel: 'Claude account 1', redacted: true },
  })]), true)
  assert.doesNotMatch(single, /Claude account 1/)

  const multiple = renderCard(snapshot([
    account({ id: 'one', identity: { title: 'Claude account 1', subtitle: null, accessibleLabel: 'Claude account 1', redacted: true } }),
    account({ id: 'two', identity: { title: 'Claude account 2', subtitle: null, accessibleLabel: 'Claude account 2', redacted: true } }),
  ]), true)
  assert.match(multiple, /Claude account 1/)
  assert.match(multiple, /Claude account 2/)
})

test('the accounts list names every account by its ordinal in privacy mode', () => {
  const privateConfig: Config = { ...config, privacyMode: true }
  const rendered = (accounts: WebAccount[]) => renderToStaticMarkup(createElement(ProvidersSettings, {
    config: privateConfig,
    snapshot: snapshot(accounts),
    onPatch: () => {}, onBack: () => {}, onDashboard: () => {},
  }))

  // A display-name-only identity: there is no email for redaction to find, and
  // the daemon identity is stale-unredacted because privacy was just turned on.
  const html = rendered([
    account({
      id: 'claude-1', name: 'Claude Jane Doe', homeDir: '/tmp/jane',
      identity: { title: 'Claude Jane Doe', subtitle: null, accessibleLabel: 'Claude Jane Doe', redacted: false },
    }),
    account({
      id: 'claude-2', name: 'Claude Jane Doe (alt)', homeDir: '/tmp/jane-alt',
      identity: { title: 'Claude account 2', subtitle: null, accessibleLabel: 'Claude account 2', redacted: true },
    }),
  ])

  assert.doesNotMatch(html, /Jane Doe/)
  assert.match(html, /Claude account 1/)
  assert.match(html, /Claude account 2/)
  assert.doesNotMatch(html, /tmp\/jane/)

  // A removed row has no resolved account, so it must not borrow an ordinal
  // that already names a live one.
  const withRemoved = renderToStaticMarkup(createElement(ProvidersSettings, {
    config: {
      ...privateConfig,
      accountDetection: {
        enabled: true, disabledProviders: [],
        excludedAccounts: [{ providerId: 'claude', homeDir: '/tmp/gone' }],
      },
    },
    snapshot: {
      ...snapshot([account({ id: 'claude-1', identity: { title: 'Claude account 1', subtitle: null, accessibleLabel: 'Claude account 1', redacted: true } })]),
      suppressedAccounts: [],
    },
    onPatch: () => {}, onBack: () => {}, onDashboard: () => {},
  }))
  assert.equal(withRemoved.match(/<b>Claude account 1<\/b>/g)?.length, 1)
  assert.equal(withRemoved.match(/<b>Claude account<\/b>/g)?.length, 1)
})

test('a removed account reads as Restore or Forget by whether its source still exists', () => {
  const removedConfig = (extra: Partial<Config> = {}): Config => ({
    ...config,
    privacyMode: false,
    accountDetection: {
      enabled: true,
      disabledProviders: [],
      excludedAccounts: [{ providerId: 'claude', homeDir: '/tmp/old-claude' }],
    },
    ...extra,
  })
  const render = (
    suppressedAccounts: WebSnapshot['suppressedAccounts'],
    cfg: Config = removedConfig(),
  ) => renderToStaticMarkup(createElement(ProvidersSettings, {
    config: cfg,
    snapshot: { ...snapshot([account({ id: 'claude-alt', homeDir: '/tmp/claude-alt' })]), suppressedAccounts },
    onPatch: () => {}, onBack: () => {}, onDashboard: () => {},
  }))

  const live = render([{ providerId: 'claude', homeDir: '/tmp/old-claude' }])
  assert.match(live, /Removed · not tracked/)
  assert.match(live, />Restore</)
  assert.doesNotMatch(live, />Forget</)

  const stranded = render([])
  assert.match(stranded, /Removed · source not found/)
  assert.match(stranded, />Forget</)
  // The row is never hidden — clearing the tombstone stays a deliberate action.
  assert.ok(stranded.includes('/tmp/old-claude'))

  // A daemon that cannot report liveness keeps the previous wording.
  const unknown = render(undefined)
  assert.match(unknown, /Removed · not tracked/)
  assert.match(unknown, />Restore</)

  // And with discovery off the exclusion suppresses nothing, so no row.
  const discoveryOff = render([], removedConfig({
    accountDetection: {
      enabled: false, disabledProviders: [],
      excludedAccounts: [{ providerId: 'claude', homeDir: '/tmp/old-claude' }],
    },
  }))
  assert.doesNotMatch(discoveryOff, /Removed ·/)
  assert.ok(!discoveryOff.includes('/tmp/old-claude'))
})
