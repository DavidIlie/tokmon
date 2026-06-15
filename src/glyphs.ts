/**
 * Every non-ASCII glyph tokmon prints, in two interchangeable sets. Legacy
 * terminals (Windows conhost, raster fonts, non-UTF-8 locales) render Unicode
 * block/box/braille/geometric glyphs as tofu, so the ASCII set is a safe
 * fallback. ASCII variants are deliberately width-1 wherever the glyph sits in
 * a width-constrained layout (dots, carets, arrows, bars, tree connectors) so
 * columns never drift; only `ellipsis` widens (handled at its call site).
 */
export interface GlyphSet {
  spark: string[]      // 8 sparkline rungs, low → high
  barFull: string
  barEmpty: string
  rule: string
  spinner: string[]
  dot: string
  dotSel: string
  radioOff: string
  dotAll: string
  caretR: string
  caretL: string
  play: string
  arrowU: string
  arrowD: string
  arrowL: string
  arrowR: string
  shift: string
  vbar: string
  treeMid: string
  treeEnd: string
  boxMark: string
  check: string
  warn: string
  ellipsis: string
  middot: string
  emDash: string
  eur: string
  gbp: string
  border: 'round' | 'classic'  // Ink borderStyle
}

export const GLYPHS_UNICODE: GlyphSet = {
  spark: ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'],
  barFull: '━', barEmpty: '─', rule: '─',
  spinner: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
  dot: '●', dotSel: '◉', radioOff: '○', dotAll: '✦',
  caretR: '▸', caretL: '◂', play: '▶',
  arrowU: '↑', arrowD: '↓', arrowL: '←', arrowR: '→',
  shift: '⇧', vbar: '▌', treeMid: '├─', treeEnd: '└─', boxMark: '│',
  check: '✓', warn: '⚠', ellipsis: '…', middot: '·', emDash: '—',
  eur: '€', gbp: '£', border: 'round',
}

export const GLYPHS_ASCII: GlyphSet = {
  spark: ['.', ':', '-', '=', '+', '*', '#', '@'],
  barFull: '#', barEmpty: '-', rule: '-',
  spinner: ['|', '/', '-', '\\'],
  dot: '*', dotSel: '*', radioOff: 'o', dotAll: '+',
  caretR: '>', caretL: '<', play: '>',
  arrowU: '^', arrowD: 'v', arrowL: '<', arrowR: '>',
  shift: '^', vbar: '|', treeMid: '+-', treeEnd: '`-', boxMark: '|',
  check: 'x', warn: '!', ellipsis: '...', middot: '-', emDash: '-',
  eur: 'EUR', gbp: 'GBP', border: 'classic',
}

/** True when the terminal can be trusted to render Unicode glyphs. Pure (env injected) for testability. */
export function detectUnicode(env: NodeJS.ProcessEnv, isTTY: boolean, platform: NodeJS.Platform): boolean {
  if (!isTTY) return false                 // piped/redirected → plain ASCII
  if (env.TERM === 'dumb') return false
  if (platform === 'win32') {
    // Legacy conhost has no reliable signal; only trust modern hosts.
    return Boolean(env.WT_SESSION || env.ConEmuANSI === 'ON' || env.TERM_PROGRAM === 'vscode' || /xterm/i.test(env.TERM ?? ''))
  }
  // mac/Linux: capable unless the locale is EXPLICITLY a non-UTF-8 charset
  // (leave unset / *.UTF-8 as capable to avoid Docker/CI false negatives).
  const loc = env.LC_ALL || env.LC_CTYPE || env.LANG || ''
  if (loc && /\.(iso|latin|ascii|cp\d|koi|gbk|big5)/i.test(loc)) return false
  if (/^(C|POSIX)$/i.test(loc)) return false
  return true
}

/** Precedence: CLI flag > TOKMON_ASCII env > config > auto-detect. */
export function resolveGlyphs(opts: {
  flag?: 'on' | 'off' | null
  env: NodeJS.ProcessEnv
  config: 'auto' | 'on' | 'off'
  isTTY: boolean
  platform: NodeJS.Platform
}): GlyphSet {
  let ascii: boolean
  if (opts.flag === 'on') ascii = true
  else if (opts.flag === 'off') ascii = false
  else {
    const e = (opts.env.TOKMON_ASCII ?? '').toLowerCase()
    if (/^(1|true|on|yes)$/.test(e)) ascii = true
    else if (/^(0|false|off|no)$/.test(e)) ascii = false
    else if (opts.config === 'on') ascii = true
    else if (opts.config === 'off') ascii = false
    else ascii = !detectUnicode(opts.env, opts.isTTY, opts.platform)
  }
  return ascii ? GLYPHS_ASCII : GLYPHS_UNICODE
}

// Resolved once at startup (cli.tsx) and read everywhere — including plain
// helper functions that can't use a React hook. The mode never changes mid-run.
let active: GlyphSet = GLYPHS_UNICODE
export function setGlyphs(set: GlyphSet): void { active = set }
export function glyphs(): GlyphSet { return active }
