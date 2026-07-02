import { memo } from 'react'
import { Box, Text, Transform } from 'ink'
import { glyphs } from '../glyphs'
import { LinkBox } from './shared'
import { openUrl, osc8, REPO_URL, SITE_URL, IS_APPLE_TERMINAL } from './terminal'

export const Footer = memo(function Footer({ hasAccounts, paginated, cols }: { hasAccounts: boolean; paginated: boolean; cols: number }) {
  const inner = cols - 4
  const BASE = 'by David Ilie (davidilie.com)  ·  O=repo  W=web  s=settings  q=quit'.length
  const optHint = (glyphs().shift === '⇧' ? '⌥' : 'opt') + '-click links  '
  const OPT = IS_APPLE_TERMINAL ? optHint.length : 0
  const JUMP = '0-9=jump  a/A=cycle  '.length
  const PAGE = 'scroll=page  '.length
  const showOpt = IS_APPLE_TERMINAL && inner >= BASE + OPT
  const showJump = hasAccounts && inner >= BASE + (showOpt ? OPT : 0) + JUMP + (paginated ? PAGE : 0)
  const showPage = paginated && inner >= BASE + (showOpt ? OPT : 0) + (showJump ? JUMP : 0) + PAGE
  if (inner < BASE) {
    return (
      <Box marginTop={1} flexWrap="nowrap">
        <Text dimColor wrap="truncate-end">O=repo  W=web  s=settings  q=quit</Text>
      </Box>
    )
  }
  return (
    <Box marginTop={1} flexWrap="nowrap">
      <Text dimColor>by </Text>
      <LinkBox onClick={() => openUrl(REPO_URL)}>
        <Transform transform={(s) => osc8(s, REPO_URL)}><Text underline>David Ilie</Text></Transform>
      </LinkBox>
      <Text dimColor> (</Text>
      <LinkBox onClick={() => openUrl(SITE_URL)}>
        <Transform transform={(s) => osc8(s, SITE_URL)}><Text color="cyan" underline>davidilie.com</Text></Transform>
      </LinkBox>
      <Text dimColor>)  {glyphs().middot}  O=repo  W=web  s=settings  </Text>
      {showOpt && <Text dimColor>{optHint}</Text>}
      {showJump && <Text dimColor>0-9=jump  a/A=cycle  </Text>}
      {showPage && <Text dimColor>scroll=page  </Text>}
      <Text dimColor>q=quit</Text>
    </Box>
  )
})
