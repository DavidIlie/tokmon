import { useState, useEffect } from 'react'
import { Box, Text } from 'ink'
import { PROVIDERS, type ProviderId, type Account } from '../providers'
import type { DashboardData } from '../types'
import type { BillingResult } from '../providers/types'
import type { AccountFetchState } from '../web/contract'
import type { AccountStats } from '../stats'
import { glyphs } from '../glyphs'
import * as fmt from '../format'
import { truncateName, metricValueText } from './shared'

type Group = { provider: ProviderId; accounts: Account[] }

export interface ReadyInput {
  summaryState: AccountFetchState
  billingState: AccountFetchState
  billing: BillingResult | null
}

export function accountReady(s: ReadyInput | undefined, providerId: ProviderId): boolean {
  if (!s) return false
  const p = PROVIDERS[providerId]
  if (p.hasBilling && (s.billingState === 'error' || s.billing?.error)) return true
  if (p.hasUsage && s.summaryState !== 'ready' && s.summaryState !== 'error') return false
  if (p.hasBilling && s.billingState !== 'ready' && s.billingState !== 'error') return false
  return true
}

export function statsReadyInput(s: AccountStats | undefined): ReadyInput | undefined {
  if (!s) return undefined
  return {
    summaryState: s.dashboard ? 'ready' : 'pending',
    billingState: s.billing?.error ? 'error' : s.billing ? 'ready' : 'pending',
    billing: s.billing,
  }
}

function groupTodayCost(items: (AccountStats | undefined)[]): number {
  return items.reduce((sum, s) => {
    const d: DashboardData | null | undefined = s?.dashboard
    return sum + (d?.today.cost ?? 0)
  }, 0)
}

function headlineFor(group: Group, items: (AccountStats | undefined)[]): string {
  const meta = PROVIDERS[group.provider]
  if (meta.hasUsage) return `${fmt.currency(groupTodayCost(items))} today`
  const billing = items.map(s => s?.billing).find(Boolean)
  if (!billing) return 'no data'
  if (billing.error) return billing.error
  const m = billing.metrics[0]
  if (m) return metricValueText(m)
  return billing.plan ?? 'no data'
}

const STAGGER_FRAMES = 2

export function LoadingView({ groups, stats, cols, rows, readyInput }: {
  groups: Group[]
  stats: Map<string, AccountStats>
  cols: number
  rows: number
  readyInput?: (id: string) => ReadyInput | undefined
}) {
  const resolveReady = readyInput ?? ((id: string) => statsReadyInput(stats.get(id)))
  const sp = glyphs().spinner
  const [frame, setFrame] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setFrame(f => f + 1), 80)
    return () => clearInterval(id)
  }, [])

  const nameW = Math.min(13, groups.reduce((w, g) => Math.max(w, PROVIDERS[g.provider].name.length), 0))

  const readyCount = groups.filter(g =>
    g.accounts.every(a => accountReady(resolveReady(a.id), g.provider))).length

  const maxRows = Math.max(1, rows - 7)
  const visible = groups.slice(0, maxRows)
  const hidden = groups.length - visible.length

  return (
    <Box flexDirection="column">
      <Text bold color="greenBright">{glyphs().dotSel} tokmon</Text>

      <Box marginTop={1}>
        <Text dimColor>Detecting installed tools{glyphs().ellipsis}</Text>
        <Text dimColor>  {groups.length} found</Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        {visible.map((g, i) => {
          const meta = PROVIDERS[g.provider]
          const items = g.accounts.map(a => stats.get(a.id))
          const ready = g.accounts.every(a => accountReady(resolveReady(a.id), g.provider))
          const errored = items.some(s => !!s?.billing?.error)
          const revealed = frame >= i * STAGGER_FRAMES
          const name = truncateName(meta.name, nameW)
          const namePad = ' '.repeat(Math.max(0, nameW - name.length))

          if (!revealed) {
            return (
              <Box key={g.provider}>
                <Text dimColor>{glyphs().dot} </Text>
                <Text dimColor>{name}{namePad}</Text>
              </Box>
            )
          }

          return (
            <Box key={g.provider}>
              <Text color={meta.color}>{glyphs().dot} </Text>
              <Text bold color={meta.color}>{name}</Text>
              <Text>{namePad}</Text>
              <Text>  </Text>
              {errored ? (
                <Text color="red">{glyphs().warn} </Text>
              ) : ready ? (
                <Text color="green">{glyphs().check} </Text>
              ) : (
                <Text color="green">{sp[frame % sp.length]} </Text>
              )}
              {errored ? (
                <Text color="red">{headlineFor(g, items)}</Text>
              ) : ready ? (
                <Text>{headlineFor(g, items)}</Text>
              ) : (
                <Text dimColor>loading{glyphs().ellipsis}</Text>
              )}
            </Box>
          )
        })}
        {hidden > 0 && <Text dimColor>+{hidden} more</Text>}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>loading {readyCount} / {groups.length}</Text>
        <Text dimColor>  {glyphs().middot}  W opens the web dashboard once loaded</Text>
      </Box>
    </Box>
  )
}
