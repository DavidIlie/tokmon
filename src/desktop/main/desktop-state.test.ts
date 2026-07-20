import assert from 'node:assert/strict'
import test from 'node:test'
import type { WebContents } from 'electron'
import { DesktopStateStore } from './desktop-state'

test('desktop state exposes the Electron bundle identity independently of the daemon', () => {
  const state = new DesktopStateStore('Tokmon', '1.2.3').get()

  assert.equal(state.appName, 'Tokmon')
  assert.equal(state.appVersion, '1.2.3')
  assert.equal(state.update.status, 'disabled')
  assert.equal(state.snapshot, null)
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
