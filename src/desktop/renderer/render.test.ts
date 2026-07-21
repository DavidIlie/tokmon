import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { DEFAULTS, type Config, type DashboardData, type Metric, type UsageSummary, type WebAccount, type WebSnapshot } from '../../web/contract'
import { DesktopSettings, DetectionSettings, Footer, SettingsHub, ThemeSettings, UpdateReady } from './desktop-chrome'
import { ProviderCard } from './provider-card'
import { groupByProvider } from './presentation'
import { providerMark } from './provider-icons'

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
    group, snapshot: snap, config: cardConfig, pinned, expanded, deny: false, refreshing: false,
    now: Date.now(), onToggle: () => {}, onPin: () => {}, onArrow: () => {},
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
  assert.match(single, /class="provider-count">· david@davidilie\.com/)
  assert.doesNotMatch(single, /class="provider-count">[^<]*(?:Claude|, David)/)
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
    appName: 'Tokmon', appVersion: '0.28.2', daemonRole: 'owner',
    onRefresh: () => {}, onSettings: () => {}, onDashboard: () => {},
  }))
  assert.match(html, /Open Dashboard/)
  assert.match(html, /Updated/)
  assert.match(html, /Tokmon 0\.28\.2/)
  assert.match(html, /aria-label="Tokmon version 0\.28\.2"/)
})

test('the footer identifies a compatible CLI-owned background service', () => {
  const html = renderToStaticMarkup(createElement(Footer, {
    snapshot: snapshot([account({})]), refreshing: false, now: Date.now(),
    appName: 'Tokmon', appVersion: '0.28.5', daemonRole: 'attached',
    onRefresh: () => {}, onSettings: () => {}, onDashboard: () => {},
  }))

  assert.match(html, /Tokmon 0\.28\.5 · CLI service/)
  assert.match(html, /using CLI background service/)
})

test('a downloaded update earns one explicit restart action above the quiet version footer', () => {
  const html = renderToStaticMarkup(createElement(UpdateReady, {
    update: { status: 'downloaded', availableVersion: '0.29.0', progressPercent: 100, error: null },
    currentVersion: '0.28.3', onInstall: () => {},
  }))

  assert.match(html, /Tokmon 0\.29\.0 is ready/)
  assert.match(html, /Current version 0\.28\.3/)
  assert.match(html, />Restart</)
  assert.equal(renderToStaticMarkup(createElement(UpdateReady, {
    update: { status: 'idle', availableVersion: null, progressPercent: null, error: null },
    currentVersion: '0.28.3', onInstall: () => {},
  })), '')
})

test('desktop settings exposes daemon-backed privacy, summary and provider pin controls', () => {
  const snap = snapshot([account({})])
  const groups = groupByProvider(snap)
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
    config: fullConfig, groups, onPatch: () => {}, onBack: () => {}, onDashboard: () => {},
  }))
  assert.match(html, /Privacy mode/)
  assert.match(html, /Provider summary/)
  assert.match(html, /Pinned providers/)
  assert.match(html, /Graph range/)
  assert.match(html, />7d<\/button>/)
  assert.match(html, /data-active="true">14d<\/button>/)
  assert.match(html, />30d<\/button>/)
  assert.match(html, /Launch at login/)
  assert.match(html, /Manage all settings/)
})

test('settings hub separates theme from desktop behavior and summarizes the shared appearance', () => {
  const fullConfig = {
    ...config,
    appearance: { version: 1, mode: 'auto', preset: 'tokmon', terminal: 'ansi' },
  } as Config
  const html = renderToStaticMarkup(createElement(SettingsHub, {
    config: fullConfig, onBack: () => {}, onTheme: () => {}, onDesktop: () => {}, onDetection: () => {},
  }))

  assert.match(html, /aria-label="Settings sections"/)
  assert.match(html, />Theme</)
  assert.match(html, /Tokmon · Auto/)
  assert.match(html, />Desktop App</)
  assert.match(html, /Menu bar, privacy, startup/)
  assert.match(html, /Accounts &amp; Detection/)
})

test('account detection settings expose global, provider, and per-account controls', () => {
  const fullConfig: Config = {
    ...config,
    privacyMode: false,
    accountDetection: {
      enabled: true,
      disabledProviders: ['codex'],
      excludedAccounts: [{ providerId: 'claude', homeDir: '/tmp/old-claude' }],
    },
  }
  const html = renderToStaticMarkup(createElement(DetectionSettings, {
    config: fullConfig,
    snapshot: snapshot([account({ id: 'claude-alt', homeDir: '/tmp/claude-alt' })]),
    onPatch: () => {}, onBack: () => {}, onDashboard: () => {},
  }))
  assert.match(html, /Discover accounts/)
  assert.match(html, /Provider detectors/)
  assert.ok(html.includes('/tmp/claude-alt'))
  assert.ok(html.includes('/tmp/old-claude'))
  assert.match(html, />Turn off</)
  assert.match(html, />Turn on</)
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
  assert.match(html, /Claude account 1/)
})
