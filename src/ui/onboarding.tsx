import { Box, Text } from 'ink'
import { ClickableBox } from './shared'

export interface OnboardItem {
  id: string
  name: string
  color: string
  detected: boolean
  enabled: boolean
}

export function Onboarding({ items, cursor, onToggle, onConfirm }: {
  items: OnboardItem[]
  cursor: number
  onToggle: (i: number) => void
  onConfirm: () => void
}) {
  const anyEnabled = items.some(it => it.enabled)
  const startIdx = items.length
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        <Text bold color="greenBright">Welcome to tokmon</Text>
      </Box>
      <Text dimColor>Pick the tools you want to track. You can change this anytime in settings.</Text>
      <Box height={1} />

      {items.map((it, i) => {
        const selected = cursor === i
        const box = it.enabled ? '[✓]' : '[ ]'
        return (
          <ClickableBox key={it.id} onClick={() => onToggle(i)}>
            <Text color={selected ? 'green' : undefined}>{selected ? '▸' : ' '} </Text>
            <Text bold={it.enabled} color={it.enabled ? it.color : undefined} dimColor={!it.enabled}>{box}</Text>
            <Text color={it.color}> ● </Text>
            <Box width={10}>
              <Text bold={selected} dimColor={!it.detected && !it.enabled}>{it.name}</Text>
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
        <Text color={cursor === startIdx ? 'green' : undefined}>{cursor === startIdx ? '▸' : ' '} </Text>
        <Text bold color={anyEnabled ? 'greenBright' : undefined} dimColor={!anyEnabled}>
          {anyEnabled ? '▶ Start tokmon' : '▶ Start (nothing selected)'}
        </Text>
      </ClickableBox>

      <Box height={1} />
      <Text dimColor>↑↓ move  ·  space toggle  ·  enter start  ·  q quit</Text>
    </Box>
  )
}
