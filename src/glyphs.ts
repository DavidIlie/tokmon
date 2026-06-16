export interface GlyphSet {
  spark: string[]
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
  border: 'round' | 'classic'
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

export function detectUnicode(env: NodeJS.ProcessEnv, isTTY: boolean, platform: NodeJS.Platform): boolean {
  if (!isTTY) return false
  if (env.TERM === 'dumb') return false
  if (platform === 'win32') {
    return Boolean(env.WT_SESSION || env.ConEmuANSI === 'ON' || env.TERM_PROGRAM === 'vscode' || /xterm/i.test(env.TERM ?? ''))
  }
  const loc = env.LC_ALL || env.LC_CTYPE || env.LANG || ''
  if (loc && /\.(iso|latin|ascii|cp\d|koi|gbk|big5)/i.test(loc)) return false
  if (/^(C|POSIX)$/i.test(loc)) return false
  return true
}

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

let active: GlyphSet = GLYPHS_UNICODE
export function setGlyphs(set: GlyphSet): void { active = set }
export function glyphs(): GlyphSet { return active }
