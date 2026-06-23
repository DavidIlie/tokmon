import { Box, Text } from 'ink'
import { glyphs } from '../glyphs'

export function ResizingView({ cols, rows }: { cols: number; rows: number }) {
  return (
    <Box width={cols} height={rows} alignItems="center" justifyContent="center">
      <Text dimColor>{glyphs().dotSel} resizing… <Text color="greenBright">{cols}</Text>×<Text color="greenBright">{rows}</Text></Text>
    </Box>
  )
}
