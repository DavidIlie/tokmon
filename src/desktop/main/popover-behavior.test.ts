import assert from 'node:assert/strict'
import test from 'node:test'
import { popoverPlatformBehavior } from './popover-behavior'

test('macOS popovers are nonactivating panels without process-type churn', () => {
  assert.deepEqual(popoverPlatformBehavior('darwin'), {
    type: 'panel',
    acceptFirstMouse: true,
    hiddenInMissionControl: true,
    visibleOnAllWorkspaces: {
      visibleOnFullScreen: true,
      skipTransformProcessType: true,
    },
    focusAfterShow: false,
  })
})

test('Windows and Linux retain ordinary focused-window behavior', () => {
  for (const platform of ['win32', 'linux'] as const) {
    const behavior = popoverPlatformBehavior(platform)
    assert.equal(behavior.type, undefined)
    assert.equal(behavior.acceptFirstMouse, false)
    assert.equal(behavior.hiddenInMissionControl, false)
    assert.deepEqual(behavior.visibleOnAllWorkspaces, { visibleOnFullScreen: true })
    assert.equal(behavior.focusAfterShow, true)
  }
})
