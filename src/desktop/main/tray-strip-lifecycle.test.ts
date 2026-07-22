import assert from 'node:assert/strict'
import test from 'node:test'
import { TrayStripLifecycle } from './tray-strip-lifecycle'

test('a validated strip survives new data, repaint, and unknown reconnect state', () => {
  const lifecycle = new TrayStripLifecycle()
  assert.equal(lifecycle.hasComposedImage, false)
  lifecycle.accept()
  lifecycle.observePinSignature('claude\0codex')
  assert.equal(lifecycle.hasComposedImage, true)
  lifecycle.observePinSignature('codex\0claude')
  assert.equal(lifecycle.hasComposedImage, true)
  lifecycle.observePinSignature(null)
  assert.equal(lifecycle.hasComposedImage, true)
})

test('an explicit empty provider selection clears the composed strip', () => {
  const lifecycle = new TrayStripLifecycle()
  lifecycle.accept()
  lifecycle.observePinSignature('')
  assert.equal(lifecycle.hasComposedImage, false)
})
