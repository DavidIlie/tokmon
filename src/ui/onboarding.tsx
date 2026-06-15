import { Box, Text } from 'ink'
import { ClickableBox } from './shared'
import { glyphs } from '../glyphs'

export interface OnboardItem {
  id: string
  name: string
  color: string
  detected: boolean
  enabled: boolean
}

export function Onboarding({ items, cursor, onToggle, onConfirm, heading = 'Welcome to tokmon', subheading = 'Pick the tools you want to track. You can change this anytime in settings.' }: {
  items: OnboardItem[]
  cursor: number
  onToggle: (i: number) => void
  onConfirm: () => void
  heading?: string
  subheading?: string
}) {
  const anyEnabled = items.some(it => it.enabled)
  const startIdx = items.length
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        <Text bold color="greenBright">{heading}</Text>
      </Box>
      <Text dimColor>{subheading}</Text>
      <Box height={1} />

      {items.map((it, i) => {
        const selected = cursor === i
        const box = it.enabled ? `[${glyphs().check}]` : '[ ]'
        return (
          <ClickableBox key={it.id} onClick={() => onToggle(i)}>
            <Text color={selected ? 'green' : undefined}>{selected ? glyphs().caretR : ' '} </Text>
            <Text bold={it.enabled} color={it.enabled ? it.color : undefined} dimColor={!it.enabled}>{box}</Text>
            <Text color={it.color}> {glyphs().dot} </Text>
            <Box width={13} flexShrink={0}>
              <Text bold={selected} dimColor={!it.detected && !it.enabled} wrap="truncate">{it.name}</Text>
            </Box>
            {it.detected
              ? <Text color="green" dimColor>installed</Text>
              : it.enabled
                ? <Text color="yellow" dimColor>manual</Text>
                : <Text dimColor>not found</Text>}
          </ClickableBox>
        )
      })}

      <Box height={1} />
      <ClickableBox onClick={onConfirm}>
        <Text color={cursor === startIdx ? 'green' : undefined}>{cursor === startIdx ? glyphs().caretR : ' '} </Text>
        <Text bold color={anyEnabled ? 'greenBright' : undefined} dimColor={!anyEnabled}>
          {anyEnabled ? `${glyphs().play} Start tokmon` : `${glyphs().play} Start (nothing selected)`}
        </Text>
      </ClickableBox>

      <Box height={1} />
      <Text dimColor>{glyphs().arrowU}{glyphs().arrowD} move  {glyphs().middot}  space toggle  {glyphs().middot}  enter start  {glyphs().middot}  q quit</Text>
    </Box>
  )
}
