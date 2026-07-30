import { Box, Text } from 'ink'
import { glyphs } from './glyphs'
import { useTuiTheme } from './theme'

export function ResizingView({ cols, rows }: { cols: number; rows: number }) {
  const theme = useTuiTheme()
  return (
    <Box width={cols} height={rows} alignItems="center" justifyContent="center">
      <Text dimColor>{glyphs().dotSel} resizing… <Text color={theme.accent}>{cols}</Text>×<Text color={theme.accent}>{rows}</Text></Text>
    </Box>
  )
}
