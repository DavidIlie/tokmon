import assert from 'node:assert/strict'
import test from 'node:test'
import { encodeTrayIconPng, rasterizeTrayIcon } from './tray-icon-raster'
import { trayIconSpec } from './tray-presentation'

test('tray icon raster contains visible alpha at 1x and 2x', () => {
  const spec = trayIconSpec(58, false)
  for (const pixels of [16, 32]) {
    const rgba = rasterizeTrayIcon(spec, pixels)
    const alpha = Array.from({ length: pixels * pixels }, (_, index) => rgba[index * 4 + 3]!)
    assert.ok(alpha.some(value => value === 255))
    assert.ok(alpha.filter(value => value > 0).length > pixels)
  }
})

test('tray icon encoder emits RGBA PNGs with the requested dimensions', () => {
  for (const pixels of [16, 32]) {
    const png = encodeTrayIconPng(trayIconSpec(58, false), pixels)
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
    assert.equal(png.readUInt32BE(16), pixels)
    assert.equal(png.readUInt32BE(20), pixels)
    assert.equal(png[25], 6)
  }
})

test('ready-to-install updates add a distinct lower-right action badge', () => {
  const ordinary = rasterizeTrayIcon(trayIconSpec(58, false), 32)
  const ready = rasterizeTrayIcon(trayIconSpec(58, false, true), 32)
  assert.equal(trayIconSpec(58, false, true).updateReady, true)
  assert.notDeepEqual(ready, ordinary)
})
