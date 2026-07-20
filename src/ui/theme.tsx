import { createContext, useContext, useMemo, type ReactNode } from 'react'
import type { AppearanceConfig, ResolvedThemeTokens } from '../theme'
import { resolveTerminalTheme } from '../theme'

export type TuiColorRole =
  | 'accent'
  | 'cost'
  | 'positive'
  | 'ok'
  | 'warn'
  | 'crit'
  | 'unknown'

export type TuiTheme = Record<TuiColorRole, string | undefined>

const ANSI_THEME: TuiTheme = {
  accent: 'greenBright',
  cost: 'yellow',
  positive: 'green',
  ok: 'green',
  warn: 'yellow',
  crit: 'red',
  unknown: undefined,
}

const NO_COLOR_THEME: TuiTheme = {
  accent: undefined,
  cost: undefined,
  positive: undefined,
  ok: undefined,
  warn: undefined,
  crit: undefined,
  unknown: undefined,
}

const TuiThemeContext = createContext<TuiTheme>(ANSI_THEME)

function fromTokens(tokens: ResolvedThemeTokens): TuiTheme {
  return {
    accent: tokens.accent,
    cost: tokens.cost,
    positive: tokens.positive,
    ok: tokens.ok,
    warn: tokens.warn,
    crit: tokens.crit,
    unknown: tokens.unknown,
  }
}

export function resolveTuiTheme(appearance: AppearanceConfig, noColor = process.env.NO_COLOR !== undefined): TuiTheme {
  if (noColor || appearance.terminal === 'off') return NO_COLOR_THEME
  const resolved = resolveTerminalTheme(appearance)
  return resolved ? fromTokens(resolved.tokens) : ANSI_THEME
}

export function TuiThemeProvider({ appearance, children }: { appearance: AppearanceConfig; children: ReactNode }) {
  const value = useMemo(() => resolveTuiTheme(appearance), [appearance])
  return <TuiThemeContext.Provider value={value}>{children}</TuiThemeContext.Provider>
}

export function useTuiTheme(): TuiTheme {
  return useContext(TuiThemeContext)
}
