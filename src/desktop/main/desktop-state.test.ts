import assert from 'node:assert/strict'
import test from 'node:test'
import type { WebContents } from 'electron'
import { DesktopStateStore, trayStripPayloadMatchesState } from './desktop-state'
import type { TrayStripPayload } from '../shared/desktop-contract'
import { DEFAULT_MENU_BAR_CONFIG } from '../../config-schema'
import { menuBarRenderSignature, menuBarValuesFromSnapshot } from '../shared/menu-bar-plan'

test('desktop state exposes the Electron bundle identity independently of the daemon', () => {
  const state = new DesktopStateStore('Tokmon', '1.2.3').get()

  assert.equal(state.appName, 'Tokmon')
  assert.equal(state.appVersion, '1.2.3')
  assert.equal(state.update.status, 'disabled')
  assert.equal(state.snapshot, null)
  assert.equal(state.displayWidthPt, 1440)
})

test('tray strip state guard rejects stale config, snapshot, pins, display bucket, and updater state', () => {
  const store = new DesktopStateStore('Tokmon', '1.2.3', null, 1440)
  const config = {
    revision: 7,
    tray: { menuBar: DEFAULT_MENU_BAR_CONFIG, menuBarValue: 'usage', activeTimeoutMin: 10 },
  } as never
  const snapshot = {
    generatedAt: 42,
    providers: [{ id: 'claude', name: 'Claude', color: '#fff' }],
    accounts: [],
  } as never
  const values = menuBarValuesFromSnapshot(snapshot, config, ['claude'])
  store.update({
    config,
    configRevision: 7,
    snapshot,
    update: { status: 'idle', availableVersion: null, progressPercent: null, error: null },
  })
  const payload: TrayStripPayload = {
    dataUrl1x: 'data:image/png;base64,AA==', dataUrl2x: 'data:image/png;base64,AA==',
    logicalWidth: 12, updateReady: false, configRevision: 7, snapshotGeneratedAt: 42,
    pinSignature: 'claude', displayWidthPt: 1600,
    renderSignature: menuBarRenderSignature({
      configRevision: 7, snapshotGeneratedAt: 42, values,
      config: DEFAULT_MENU_BAR_CONFIG, valueMode: 'usage', displayWidthPt: 1600, updateReady: false,
      updateStatus: 'idle',
    }),
  }
  assert.equal(trayStripPayloadMatchesState(payload, store.get(), 'claude'), true)
  assert.equal(trayStripPayloadMatchesState({ ...payload, configRevision: 6 }, store.get(), 'claude'), false)
  assert.equal(trayStripPayloadMatchesState({ ...payload, snapshotGeneratedAt: 41 }, store.get(), 'claude'), false)
  assert.equal(trayStripPayloadMatchesState({ ...payload, pinSignature: 'codex' }, store.get(), 'claude'), false)
  assert.equal(trayStripPayloadMatchesState({ ...payload, displayWidthPt: 1300 }, store.get(), 'claude'), false)
  assert.equal(trayStripPayloadMatchesState({ ...payload, updateReady: true }, store.get(), 'claude'), false)
  assert.equal(trayStripPayloadMatchesState({ ...payload, renderSignature: '{}' }, store.get(), 'claude'), false)
})

test('desktop state broadcasts a config revision only once', () => {
  const sent: unknown[] = []
  const target = {
    once: () => {},
    isDestroyed: () => false,
    send: (_channel: string, state: unknown) => { sent.push(state) },
  } as unknown as WebContents
  const store = new DesktopStateStore()
  store.addTarget(target)
  const config = { revision: 7 } as never

  store.config(config, 7)
  store.config({ revision: 7 } as never, 7)

  assert.equal(sent.length, 1)
  assert.equal(store.get().config, config)
  assert.equal(store.get().configRevision, 7)
})

test('a repeated config revision still clears a connection error', () => {
  const store = new DesktopStateStore()
  const config = { revision: 7 } as never
  store.config(config, 7)
  store.connection('error', new Error('temporary disconnect'))

  store.config(config, 7)

  assert.equal(store.get().error, null)
})
