import { memo } from 'react'
import { Box, Text } from 'ink'
import { glyphs } from '../glyphs'
import { configLocation, generateAccountId, COLOR_PALETTE, type Config, type Account } from '../config'
import { PROVIDER_ORDER, PROVIDERS } from '../providers'
import type { ProviderId } from '../providers/types'
import { truncateName } from './shared'

export const GENERAL_ROWS = 6
export const PROVIDER_ROWS_START = GENERAL_ROWS
export const ACCOUNT_ROWS_START = GENERAL_ROWS + PROVIDER_ORDER.length

export type FormField = 'provider' | 'name' | 'homeDir' | 'color'

export interface AccountForm {
  mode: 'add' | 'edit'
  field: FormField
  providerId: ProviderId
  name: string
  homeDir: string
  color: string
  caret: number
  editingId: string | null
  error: string | null
}

export const FORM_FIELDS: FormField[] = ['provider', 'name', 'homeDir', 'color']

export { COLOR_PALETTE } from '../config'

export const SettingsView = memo(function SettingsView({
  config, cursor, tzEdit, tzCaret, tzError, resolvedTz, accountForm, activeAccountId,
}: {
  config: Config
  cursor: number
  tzEdit: string | null
  tzCaret: number
  tzError: string | null
  resolvedTz: string
  accountForm: AccountForm | null
  activeAccountId: string | null
}) {
  if (accountForm) return <AccountFormView form={accountForm} accounts={config.accounts} />

  const editingTz = tzEdit !== null
  const tzDisplay = config.timezone === null ? `System (${resolvedTz})` : config.timezone

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>Settings</Text>
      <Text dimColor>{configLocation()}</Text>
      <Box height={1} />
      <Text bold dimColor>General</Text>
      <Row cursor={cursor} idx={0} label="Refresh interval">
        <Text dimColor>{glyphs().caretL} </Text><Text bold color="yellow">{config.interval}s</Text><Text dimColor> {glyphs().caretR}</Text>
      </Row>
      <Row cursor={cursor} idx={1} label="Billing poll">
        <Text dimColor>{glyphs().caretL} </Text><Text bold color="yellow">{config.billingInterval}m</Text><Text dimColor> {glyphs().caretR}</Text>
      </Row>
      <Row cursor={cursor} idx={2} label="Clear screen">
        <Text bold color={config.clearScreen ? 'green' : 'red'}>{config.clearScreen ? 'on' : 'off'}</Text>
      </Row>
      <Row cursor={cursor} idx={3} label="Timezone">
        {editingTz ? (
          <><Text dimColor>[</Text><CaretText value={tzEdit ?? ''} caret={tzCaret} color="cyan" /><Text dimColor>]</Text></>
        ) : (
          <Text bold color="yellow">{tzDisplay}</Text>
        )}
      </Row>
      {cursor === 3 && tzError && <Text color="red">  {tzError}</Text>}
      <Row cursor={cursor} idx={4} label="Dashboard">
        <Text dimColor>{glyphs().caretL} </Text>
        <Text bold color="yellow">{config.dashboardLayout === 'grid' ? 'grid (all)' : 'single (cycle)'}</Text>
        <Text dimColor> {glyphs().caretR}</Text>
      </Row>
      <Row cursor={cursor} idx={5} label="Default focus">
        <Text dimColor>{glyphs().caretL} </Text>
        <Text bold color="yellow">{config.defaultFocus === 'all' ? 'All' : 'Last account'}</Text>
        <Text dimColor> {glyphs().caretR}</Text>
      </Row>

      <Box height={1} />
      <Text bold dimColor>Providers</Text>
      {PROVIDER_ORDER.map((pid, i) => {
        const idx = PROVIDER_ROWS_START + i
        const selected = cursor === idx
        const enabled = !config.disabledProviders.includes(pid)
        const p = PROVIDERS[pid]
        return (
          <Box key={pid}>
            <Text color={selected ? 'green' : undefined}>{selected ? glyphs().caretR : ' '} </Text>
            <Text bold={enabled} color={enabled ? p.color : undefined} dimColor={!enabled}>{enabled ? `[${glyphs().check}]` : '[ ]'}</Text>
            <Text color={p.color}> {glyphs().dot} </Text>
            <Box width={9}><Text bold={selected}>{p.name}</Text></Box>
            <Text dimColor>{enabled ? 'tracking' : 'off'}</Text>
          </Box>
        )
      })}

      <Box height={1} />
      <Text bold dimColor>Accounts</Text>
      {config.accounts.length === 0 && (
        <Text dimColor>  none configured {glyphs().emDash} enabled providers track automatically</Text>
      )}
      {config.accounts.map((acc, i) => {
        const idx = ACCOUNT_ROWS_START + i
        const selected = cursor === idx
        const isActive = acc.id === activeAccountId
        const provider = PROVIDERS[acc.providerId]
        return (
          <Box key={acc.id}>
            <Text color={selected ? 'green' : undefined}>{selected ? glyphs().caretR : ' '} </Text>
            <Text color={acc.color || provider.color}>{isActive ? glyphs().dot : glyphs().radioOff} </Text>
            <Box width={16}><Text bold>{truncateName(acc.name, 15)}</Text></Box>
            <Box width={9}><Text color={provider.color}>{provider.name}</Text></Box>
            <Text dimColor>{truncateName(acc.homeDir, 24)}</Text>
          </Box>
        )
      })}
      <Box>
        <Text color={cursor === ACCOUNT_ROWS_START + config.accounts.length ? 'green' : undefined}>
          {cursor === ACCOUNT_ROWS_START + config.accounts.length ? glyphs().caretR : ' '}{' '}
        </Text>
        <Text color="greenBright">+ </Text>
        <Text>Add account</Text>
      </Box>

      <Box height={1} />
      {editingTz ? (
        <Text dimColor>type IANA name (e.g. Europe/London) {glyphs().middot} empty = System {glyphs().middot} Enter save {glyphs().middot} Esc cancel</Text>
      ) : cursor >= PROVIDER_ROWS_START && cursor < ACCOUNT_ROWS_START ? (
        <Text dimColor>{glyphs().arrowU}{glyphs().arrowD} select  {glyphs().middot}  space toggle provider  {glyphs().middot}  s/Esc close</Text>
      ) : cursor >= ACCOUNT_ROWS_START && cursor < ACCOUNT_ROWS_START + config.accounts.length ? (
        <Text dimColor>{glyphs().arrowU}{glyphs().arrowD} select  {glyphs().middot}  {glyphs().shift}{glyphs().arrowU}{glyphs().arrowD} reorder  {glyphs().middot}  Enter edit  {glyphs().middot}  space activate  {glyphs().middot}  d delete  {glyphs().middot}  s/Esc close</Text>
      ) : cursor === ACCOUNT_ROWS_START + config.accounts.length ? (
        <Text dimColor>{glyphs().arrowU}{glyphs().arrowD} select  {glyphs().middot}  Enter add account  {glyphs().middot}  s/Esc close</Text>
      ) : (
        <Text dimColor>{glyphs().arrowU}{glyphs().arrowD} select  {glyphs().arrowL}{glyphs().arrowR} adjust  Enter edit  s/Esc close</Text>
      )}
    </Box>
  )
})

export function CaretText({ value, caret, color }: { value: string; caret: number; color?: string }) {
  const c = Math.max(0, Math.min(caret, value.length))
  if (c >= value.length) {
    return <><Text bold color={color}>{value}</Text><Text color={color}>{glyphs().vbar}</Text></>
  }
  return (
    <>
      <Text bold color={color}>{value.slice(0, c)}</Text>
      <Text inverse color={color}>{value[c]}</Text>
      <Text bold color={color}>{value.slice(c + 1)}</Text>
    </>
  )
}

function Row({ cursor, idx, label, children }: { cursor: number; idx: number; label: string; children: React.ReactNode }) {
  return (
    <Box>
      <Text color={cursor === idx ? 'green' : undefined}>{cursor === idx ? glyphs().caretR : ' '} </Text>
      <Box width={20}><Text>{label}</Text></Box>
      {children}
    </Box>
  )
}

function AccountFormView({ form, accounts }: { form: AccountForm; accounts: Account[] }) {
  const previewId = form.mode === 'add'
    ? generateAccountId(form.name || 'account', accounts)
    : form.editingId ?? ''
  const accent = form.color
  const stepIndex: Record<FormField, number> = { provider: 1, name: 2, homeDir: 3, color: 4 }
  const step = stepIndex[form.field]

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        <Text color={accent} bold>{glyphs().vbar}</Text>
        <Text bold>{' '}{form.mode === 'add' ? 'NEW ACCOUNT' : 'EDIT ACCOUNT'}</Text>
        <Text dimColor>   step {step} of 4</Text>
      </Box>
      <Box marginTop={1}><Stepper active={form.field} accent={accent} /></Box>

      <Box marginTop={1} flexDirection="column" borderStyle={glyphs().border} borderColor={accent} paddingX={2} paddingY={1}>
        <ProviderField value={form.providerId} focused={form.field === 'provider'} />
        <Box height={1} />
        <FormField label="Name" hint="display name for this account" value={form.name}
          focused={form.field === 'name'} caret={form.caret} accent={accent} placeholder="e.g. Work, Personal" />
        <Box height={1} />
        <FormField label="Home directory" hint={`path containing the tool's data dir  ${glyphs().middot}  ~ for default`} value={form.homeDir}
          focused={form.field === 'homeDir'} caret={form.caret} accent={accent} placeholder="~/work" mono />
        <Box height={1} />
        <ColorField value={form.color} focused={form.field === 'color'} />
        <Box height={1} />
        <Box>
          <Text dimColor>id  {glyphs().boxMark} </Text>
          <Text bold color={accent}>{previewId || 'account'}</Text>
          <Text dimColor> {glyphs().boxMark}   auto-generated from name</Text>
        </Box>
      </Box>

      {form.error && <Box marginTop={1}><Text color="red">{glyphs().warn} {form.error}</Text></Box>}

      <Box marginTop={1}>
        <Text dimColor>tab/{glyphs().arrowU}{glyphs().arrowD} </Text><Text>switch field</Text><Text dimColor>  {glyphs().middot}  </Text>
        <Text dimColor>enter </Text><Text>{form.field === 'color' ? 'save' : 'next'}</Text><Text dimColor>  {glyphs().middot}  </Text>
        {(form.field === 'color' || form.field === 'provider') ? (
          <><Text dimColor>{glyphs().arrowL}{glyphs().arrowR} </Text><Text>{form.field === 'provider' ? 'pick provider' : 'pick color'}</Text><Text dimColor>  {glyphs().middot}  </Text></>
        ) : (
          <><Text dimColor>{glyphs().arrowL}{glyphs().arrowR} </Text><Text>move caret</Text><Text dimColor>  {glyphs().middot}  </Text></>
        )}
        <Text dimColor>ctrl+s </Text><Text>save</Text><Text dimColor>  {glyphs().middot}  </Text>
        <Text dimColor>esc </Text><Text>cancel</Text>
      </Box>
    </Box>
  )
}

function Stepper({ active, accent }: { active: FormField; accent: string }) {
  const steps: { id: FormField; label: string }[] = [
    { id: 'provider', label: 'Provider' },
    { id: 'name', label: 'Name' },
    { id: 'homeDir', label: 'Home' },
    { id: 'color', label: 'Color' },
  ]
  const activeIdx = steps.findIndex(s => s.id === active)
  return (
    <Box>
      {steps.map((s, i) => {
        const done = i < activeIdx
        const cur = i === activeIdx
        const dot = done ? glyphs().dot : cur ? glyphs().dotSel : glyphs().radioOff
        return (
          <Box key={s.id}>
            <Text color={cur || done ? accent : undefined} dimColor={!cur && !done}>{dot} </Text>
            <Text bold={cur} color={cur ? accent : undefined} dimColor={!cur}>{s.label}</Text>
            {i < steps.length - 1 && <Text dimColor>  {glyphs().rule}  </Text>}
          </Box>
        )
      })}
    </Box>
  )
}

function ProviderField({ value, focused }: { value: ProviderId; focused: boolean }) {
  return (
    <Box flexDirection="column">
      <Box>
        <Text color={focused ? PROVIDERS[value].color : undefined} bold={focused} dimColor={!focused}>
          {focused ? glyphs().caretR : ' '} Provider
        </Text>
      </Box>
      <Box>
        <Text>  {focused ? glyphs().vbar : ' '} </Text>
        {PROVIDER_ORDER.map(pid => {
          const selected = pid === value
          const p = PROVIDERS[pid]
          return (
            <Box key={pid} marginRight={2}>
              {selected
                ? <Text bold color={p.color}>[{p.name}]</Text>
                : <Text dimColor>{p.name}</Text>}
            </Box>
          )
        })}
      </Box>
      <Box><Text dimColor>      which tool this account tracks</Text></Box>
    </Box>
  )
}

function FormField({ label, hint, value, focused, caret, accent, placeholder, mono }: {
  label: string; hint: string; value: string; focused: boolean; caret?: number; accent: string; placeholder: string; mono?: boolean
}) {
  const isPlaceholder = value === ''
  const display = isPlaceholder ? placeholder : value
  return (
    <Box flexDirection="column">
      <Box>
        <Text color={focused ? accent : undefined} bold={focused} dimColor={!focused}>
          {focused ? glyphs().caretR : ' '} {label}
        </Text>
      </Box>
      <Box>
        <Text color={focused ? accent : undefined}>  {focused ? glyphs().vbar : ' '} </Text>
        {focused
          ? isPlaceholder
            ? <><Text color={accent}>{glyphs().vbar}</Text><Text dimColor italic={mono}>{placeholder}</Text></>
            : <CaretText value={value} caret={caret ?? value.length} color={accent} />
          : <Text dimColor={isPlaceholder} italic={mono && isPlaceholder}>{display}</Text>}
      </Box>
      <Box><Text dimColor>      {hint}</Text></Box>
    </Box>
  )
}

function ColorField({ value, focused }: { value: string; focused: boolean }) {
  return (
    <Box flexDirection="column">
      <Box>
        <Text color={focused ? value : undefined} bold={focused} dimColor={!focused}>
          {focused ? glyphs().caretR : ' '} Accent color
        </Text>
      </Box>
      <Box>
        <Text>  {focused ? glyphs().vbar : ' '} </Text>
        {COLOR_PALETTE.map(c => (
          <Box key={c} marginRight={1}>
            {c === value ? <Text bold color={c}>[{glyphs().dot}]</Text> : <Text color={c} dimColor={!focused}> {glyphs().dot}</Text>}
          </Box>
        ))}
      </Box>
      <Box><Text dimColor>      shows on dashboard, account strip, borders</Text></Box>
    </Box>
  )
}
