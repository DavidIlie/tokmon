import assert from 'node:assert/strict'
import test from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { DEFAULTS } from '@shared'
import { AppSection } from './app-section'

test('app settings expose the menu-bar builder without a duplicate provider pin editor', () => {
  const draft = structuredClone(DEFAULTS)
  draft.tray.menuBar.mode = 'custom'
  const html = renderToStaticMarkup(
    <AppSection draft={draft} patch={() => {}} snapshot={null} />,
  )

  assert.match(html, /macOS menu bar/)
  assert.match(html, /Pin providers from their cards in the desktop overview/)
  assert.match(html, /provider mark/)
  assert.match(html, /Edge padding/)
  assert.doesNotMatch(html, /Menu bar providers/)
  assert.doesNotMatch(html, /pinned<\/span>/)
})
