export interface Rect { x: number; y: number; width: number; height: number }
export interface Size { width: number; height: number }

/** Which side of the tray the popover opens on. `below` is the top-menu-bar
 * default (macOS / Windows top); `above` is a bottom taskbar; `left`/`right`
 * are vertical taskbars (the popover sits beside the tray). */
export type PopoverPlacement = 'below' | 'above' | 'left' | 'right'

const GAP = 6
const EDGE_MARGIN = 8

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

/** Single source of truth for the placement direction, derived from the
 * nearest screen edge. Both {@link positionPopover} (where it draws) and
 * {@link availablePopoverHeight} (how tall it may be) consume this so they can
 * never disagree about the direction. */
export function popoverPlacement(tray: Rect, workArea: Rect): PopoverPlacement {
  const topDistance = Math.abs(tray.y - workArea.y)
  const bottomDistance = Math.abs(workArea.y + workArea.height - (tray.y + tray.height))
  const leftDistance = Math.abs(tray.x - workArea.x)
  const rightDistance = Math.abs(workArea.x + workArea.width - (tray.x + tray.width))
  const nearest = Math.min(topDistance, bottomDistance, leftDistance, rightDistance)
  if (nearest === bottomDistance) return 'above'
  if (nearest === leftDistance) return 'right'
  if (nearest === rightDistance) return 'left'
  return 'below'
}

/** Vertical room (DIP) available to the popover for a given placement. For
 * `below`/`above` this is the gap between the tray and the far work-area edge;
 * for the beside-tray placements the window is vertically centered on the tray,
 * so it may use (almost) the full work-area height. Never negative. */
export function availablePopoverHeight(tray: Rect, workArea: Rect, placement: PopoverPlacement, gap = GAP): number {
  let room: number
  switch (placement) {
    case 'below':
      room = workArea.y + workArea.height - (tray.y + tray.height) - gap - EDGE_MARGIN
      break
    case 'above':
      room = tray.y - workArea.y - gap - EDGE_MARGIN
      break
    case 'left':
    case 'right':
      room = workArea.height - EDGE_MARGIN * 2
      break
  }
  return Math.max(0, room)
}

/** Pure screen-edge-aware positioning for native tray bounds, expressed in DIP. */
export function positionPopover(tray: Rect, workArea: Rect, size: Size): { x: number; y: number; placement: PopoverPlacement } {
  const centerX = tray.x + tray.width / 2
  const centerY = tray.y + tray.height / 2
  const placement = popoverPlacement(tray, workArea)

  let x = centerX - size.width / 2
  let y = tray.y + tray.height + GAP
  if (placement === 'above') y = tray.y - size.height - GAP
  else if (placement === 'right') {
    x = tray.x + tray.width + GAP
    y = centerY - size.height / 2
  } else if (placement === 'left') {
    x = tray.x - size.width - GAP
    y = centerY - size.height / 2
  }

  return {
    x: Math.round(clamp(x, workArea.x, workArea.x + workArea.width - size.width)),
    y: Math.round(clamp(y, workArea.y, workArea.y + workArea.height - size.height)),
    placement,
  }
}

export function centeredPopover(workArea: Rect, size: Size): { x: number; y: number } {
  return {
    x: Math.round(workArea.x + (workArea.width - size.width) / 2),
    y: Math.round(workArea.y + (workArea.height - size.height) / 2),
  }
}

/** Vertical room (DIP) for a centered popover (the Linux path, which uses
 * {@link centeredPopover} rather than {@link positionPopover}). The window is
 * centered in the work area, so it may use the full height minus a small edge
 * margin on each side. Never negative. */
export function availableCenteredHeight(workArea: Rect, margin = EDGE_MARGIN): number {
  return Math.max(0, workArea.height - margin * 2)
}
