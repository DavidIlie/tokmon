import { memo } from 'react'
import { Text } from 'ink'
import { glyphs } from '../glyphs'
import type { RefreshStatus } from './hooks/use-refresh-all'
import { Spinner } from './shared'

export const RefreshStatusLine = memo(function RefreshStatusLine({ status }: { status: RefreshStatus }) {
  if (status.phase === 'idle') return null
  if (status.phase === 'refreshing') return <Spinner label={`${status.message}${glyphs().ellipsis}`} />
  if (status.phase === 'success') return <Text color="green">{glyphs().check} {status.message}</Text>
  return <Text color="red">{glyphs().warn} {status.message}</Text>
})
