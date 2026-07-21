export {
  cleanProviderSelection,
  toggleProviderSelection,
} from '../../../../src/config-schema'

import {
  DEFAULT_MENU_BAR_CONFIG,
  type MenuBarConfig,
} from '../../../../src/config-schema'

export type MenuBarElement = keyof MenuBarConfig['elements']

/** Toggle one presentation element without allowing an invisible menu-bar item. */
export function toggleMenuBarElement(
  elements: MenuBarConfig['elements'],
  element: MenuBarElement,
): MenuBarConfig['elements'] {
  if (elements[element] && Object.values(elements).filter(Boolean).length === 1) return elements
  return { ...elements, [element]: !elements[element] }
}

/** Reset presentation only. Pins and the selected value source live outside this block. */
export function defaultMenuBarPresentation(): MenuBarConfig {
  return {
    ...DEFAULT_MENU_BAR_CONFIG,
    elements: { ...DEFAULT_MENU_BAR_CONFIG.elements },
    customSpacing: { ...DEFAULT_MENU_BAR_CONFIG.customSpacing },
  }
}
