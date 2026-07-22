import assert from 'node:assert/strict'
import test from 'node:test'
import { releasePopoverFocus } from './popover-focus'

test('hiding the popover releases retained control focus', () => {
  let blurred = 0
  assert.equal(releasePopoverFocus({ blur: () => { blurred += 1 } }), true)
  assert.equal(blurred, 1)
  assert.equal(releasePopoverFocus(null), false)
  assert.equal(releasePopoverFocus({}), false)
})
