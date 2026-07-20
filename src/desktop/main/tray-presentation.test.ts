import assert from 'node:assert/strict'
import test from 'node:test'
import { disconnectedMenuBarTitle, menuBarTitle, trayIconSpec } from './tray-presentation'

test('tray icon uses crisp 16pt geometry with explicit Retina representation', () => {
  const spec = trayIconSpec(50, false)
  assert.equal(spec.pointSize, 16)
  assert.deepEqual(spec.scaleFactors, [1, 2])
  assert.equal(spec.unlitOpacity, 0.45)
  assert.equal(spec.tickCount, 12)
  assert.equal(spec.litTicks, 6)
  assert.equal(trayIconSpec(80, false).litTicks, 10)
})

test('menu-bar titles are terse and never carry a cryptic "!" prefix', () => {
  assert.equal(menuBarTitle(true, 91.4, true), '91%') // high usage, never prefixed with punctuation
  assert.equal(menuBarTitle(true, 0.2, true), '<1%')
  assert.equal(menuBarTitle(true, 64.4, false), '64%')
  assert.equal(menuBarTitle(false, 8, true), '')
  assert.equal(disconnectedMenuBarTitle(true), '')
  assert.equal(disconnectedMenuBarTitle(false), '')
})
