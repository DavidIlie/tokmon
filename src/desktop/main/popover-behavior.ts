export interface PopoverPlatformBehavior {
  type: 'panel' | undefined
  acceptFirstMouse: boolean
  hiddenInMissionControl: boolean
  visibleOnAllWorkspaces: {
    visibleOnFullScreen: true
    skipTransformProcessType?: true
  }
  focusAfterShow: boolean
}

/** Native-window policy kept pure so macOS activation behavior is regression tested. */
export function popoverPlatformBehavior(platform: NodeJS.Platform): PopoverPlatformBehavior {
  const mac = platform === 'darwin'
  return {
    type: mac ? 'panel' : undefined,
    acceptFirstMouse: mac,
    hiddenInMissionControl: mac,
    visibleOnAllWorkspaces: mac
      ? { visibleOnFullScreen: true, skipTransformProcessType: true }
      : { visibleOnFullScreen: true },
    // A macOS panel becomes key without activating the app or switching Spaces.
    // Normal Windows/Linux windows retain the existing explicit focus behavior.
    focusAfterShow: !mac,
  }
}
