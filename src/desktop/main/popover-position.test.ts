import assert from 'node:assert/strict'
import test from 'node:test'
import {
  availableCenteredHeight,
  availablePopoverHeight,
  centeredPopover,
  popoverPlacement,
  positionPopover,
  usableTrayBounds,
  type Rect,
  type Size,
} from './popover-position'

const area = { x: 0, y: 0, width: 1920, height: 1080 }
const size = { width: 360, height: 560 }

test('top tray centers and clamps the popover beneath its anchor', () => {
  assert.deepEqual(positionPopover({ x: 1800, y: 0, width: 24, height: 24 }, area, size), { x: 1560, y: 30, placement: 'below' })
})

test('empty or invalid tray bounds are not treated as a screen-edge anchor', () => {
  assert.equal(usableTrayBounds({ x: 0, y: 0, width: 0, height: 0 }), false)
  assert.equal(usableTrayBounds({ x: 0, y: 0, width: 24, height: 24 }), true)
  assert.equal(usableTrayBounds({ x: 0, y: 0, width: 24, height: 24 }, true), false)
  assert.equal(usableTrayBounds({ x: 0, y: 25, width: 24, height: 24 }, true), false)
  assert.equal(usableTrayBounds({ x: 1200, y: 0, width: 24, height: 24 }, true), true)
  assert.equal(usableTrayBounds({ x: Number.NaN, y: 0, width: 24, height: 24 }), false)
})

test('bottom and side taskbars place the popover inward', () => {
  assert.deepEqual(positionPopover({ x: 900, y: 1056, width: 24, height: 24 }, area, size), { x: 732, y: 490, placement: 'above' })
  assert.deepEqual(positionPopover({ x: 0, y: 500, width: 24, height: 24 }, area, size), { x: 30, y: 232, placement: 'right' })
  assert.deepEqual(positionPopover({ x: 1896, y: 500, width: 24, height: 24 }, area, size), { x: 1530, y: 232, placement: 'left' })
})

test('Wayland fallback uses an ordinary centered utility window', () => {
  assert.deepEqual(centeredPopover(area, size), { x: 780, y: 260 })
})

// --- DESKTOP-H1: directional sizing ---

const SIZE: Size = { width: 360, height: 500 }

// Scenarios where the popover opens away from the nearest edge, so sizing must
// follow the placement direction rather than always measuring below the tray.
const SCENARIOS = {
  topMenuBar: {
    tray: { x: 1200, y: 0, width: 24, height: 24 } as Rect,
    workArea: { x: 0, y: 0, width: 1440, height: 875 } as Rect,
    placement: 'below' as const,
  },
  bottomTaskbar: {
    tray: { x: 1700, y: 1048, width: 24, height: 24 } as Rect,
    workArea: { x: 0, y: 0, width: 1920, height: 1040 } as Rect,
    placement: 'above' as const,
  },
  leftTaskbar: {
    tray: { x: 0, y: 500, width: 24, height: 24 } as Rect,
    workArea: { x: 48, y: 0, width: 1872, height: 1080 } as Rect,
    placement: 'right' as const,
  },
  rightTaskbar: {
    tray: { x: 1900, y: 500, width: 20, height: 24 } as Rect,
    workArea: { x: 0, y: 0, width: 1872, height: 1080 } as Rect,
    placement: 'left' as const,
  },
}

test('placement is chosen from the nearest screen edge for each taskbar position', () => {
  for (const [name, s] of Object.entries(SCENARIOS)) {
    assert.equal(popoverPlacement(s.tray, s.workArea), s.placement, name)
  }
})

test('positionPopover and popoverPlacement never disagree on direction', () => {
  for (const [name, s] of Object.entries(SCENARIOS)) {
    const placed = positionPopover(s.tray, s.workArea, SIZE)
    assert.equal(placed.placement, popoverPlacement(s.tray, s.workArea), name)
    assert.equal(placed.placement, s.placement, name)
  }
})

test('positioned geometry matches the placement it reports', () => {
  const below = positionPopover(SCENARIOS.topMenuBar.tray, SCENARIOS.topMenuBar.workArea, SIZE)
  // opens below the tray: popover top is at/under the tray bottom.
  assert.ok(below.y >= SCENARIOS.topMenuBar.tray.y + SCENARIOS.topMenuBar.tray.height)

  const above = positionPopover(SCENARIOS.bottomTaskbar.tray, SCENARIOS.bottomTaskbar.workArea, SIZE)
  // opens above the tray: popover bottom is at/above the tray top.
  assert.ok(above.y + SIZE.height <= SCENARIOS.bottomTaskbar.tray.y)

  const right = positionPopover(SCENARIOS.leftTaskbar.tray, SCENARIOS.leftTaskbar.workArea, SIZE)
  // opens to the right of the tray.
  assert.ok(right.x >= SCENARIOS.leftTaskbar.tray.x + SCENARIOS.leftTaskbar.tray.width)

  const left = positionPopover(SCENARIOS.rightTaskbar.tray, SCENARIOS.rightTaskbar.workArea, SIZE)
  // opens to the left of the tray.
  assert.ok(left.x + SIZE.width <= SCENARIOS.rightTaskbar.tray.x)
})

test('height budget follows the placement direction, not the space below the tray', () => {
  // Regression guard: below-the-tray room for a bottom/side taskbar is tiny or
  // negative, which is exactly what the old setHeight clamped against. The
  // direction-aware budget must instead reflect the roomy side.
  for (const key of ['bottomTaskbar', 'leftTaskbar', 'rightTaskbar'] as const) {
    const s = SCENARIOS[key]
    const belowRoom = s.workArea.y + s.workArea.height - (s.tray.y + s.tray.height)
    const budget = availablePopoverHeight(s.tray, s.workArea, s.placement)
    assert.ok(budget >= 400, `${key} budget ${budget} should be generous`)
    assert.ok(budget > belowRoom, `${key} budget ${budget} should beat below-tray room ${belowRoom}`)
  }
})

test('availablePopoverHeight is clamped at zero and never negative', () => {
  // Tray flush against the top edge: no room above.
  const tray: Rect = { x: 10, y: 0, width: 24, height: 24 }
  const workArea: Rect = { x: 0, y: 0, width: 800, height: 600 }
  assert.equal(availablePopoverHeight(tray, workArea, 'above'), 0)
})

test('Linux centered path sizes against the full work-area height, not below-tray', () => {
  // Linux uses centeredPopover (never positionPopover), so setHeight clamps to
  // availableCenteredHeight. Even with a tray pinned to a bottom taskbar, the
  // centered budget stays generous rather than collapsing to below-tray room.
  const { tray, workArea } = SCENARIOS.bottomTaskbar
  const budget = availableCenteredHeight(workArea)
  assert.equal(budget, workArea.height - 16)
  const belowRoom = workArea.y + workArea.height - (tray.y + tray.height)
  assert.ok(budget > belowRoom)
  // Degenerate work area cannot produce a negative budget.
  assert.equal(availableCenteredHeight({ x: 0, y: 0, width: 100, height: 8 }), 0)
})
