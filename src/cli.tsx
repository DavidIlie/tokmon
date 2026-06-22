import { EventEmitter } from 'node:events'

process.on('unhandledRejection', () => {})

EventEmitter.defaultMaxListeners = 100

const emitWarning = process.emitWarning.bind(process)
process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
  const msg = typeof warning === 'string' ? warning : warning?.message
  if (typeof msg === 'string' && /SQLite is an experimental feature/i.test(msg)) return
  return (emitWarning as (...a: unknown[]) => void)(warning, ...rest)
}) as typeof process.emitWarning

const args = process.argv.slice(2)

const subcommand = args[0]?.toLowerCase()

// Ephemeral daemon child: spawned + supervised by the TUI. Emits a one-line
// JSON handshake on stdout, opens no browser, dies with the parent. MUST be
// handled before any TTY/glyph setup so the handshake is the first stdout line.
if (subcommand === '__daemon') {
  const { runDaemon } = await import('./web/daemon')
  await runDaemon(args.slice(1), { foreground: false })
  process.exit(typeof process.exitCode === 'number' ? process.exitCode : 0)
}

if (subcommand === 'serve' || subcommand === 'web') {
  const { runDaemon } = await import('./web/daemon')
  await runDaemon(args.slice(1), { foreground: true })
  process.exit(typeof process.exitCode === 'number' ? process.exitCode : 0)
}

let interval: number | undefined
let asciiFlag: 'on' | 'off' | null = null

for (let i = 0; i < args.length; i++) {
  if ((args[i] === '--interval' || args[i] === '-i') && args[i + 1]) {
    interval = Math.max(500, Number(args[i + 1]) * 1000)
    i++
  }
  if (args[i] === '--ascii') asciiFlag = 'on'
  if (args[i] === '--no-ascii') asciiFlag = 'off'
  if (args[i] === '--help' || args[i] === '-h') {
    console.log('tokmon - Terminal usage dashboard for your AI coding tools\n')
    console.log('  Claude · Codex · Cursor · Copilot · opencode · pi · Antigravity · Gemini\n')
    console.log('Usage: tokmon [options]')
    console.log('       tokmon serve [--port <n>] [--no-open]   Launch the web dashboard\n')
    console.log('Options:')
    console.log('  -i, --interval <seconds>  Refresh interval (default: from config or 2)')
    console.log('      --ascii               Force ASCII glyphs (also: TOKMON_ASCII=1)')
    console.log('      --no-ascii            Force Unicode glyphs')
    console.log('  -h, --help                Show this help\n')
    console.log('Keybindings:')
    console.log('  Tab         Switch Dashboard / Table')
    console.log('  p / P       Cycle table provider')
    console.log('  a / A       Cycle account focus')
    console.log('  0-9         Jump to account focus')
    console.log('  ↑↓          Scroll table')
    console.log('  w / W       Toggle web dashboard')
    console.log('  s           Settings')
    console.log('  q           Quit')
    process.exit(0)
  }
}

const { loadConfig } = await import('./config')
const { resolveGlyphs, setGlyphs } = await import('./glyphs')
const { attachOrSpawn } = await import('./client/daemon-handle')

const config = await loadConfig()

const isTTY = process.stdout.isTTY === true

setGlyphs(resolveGlyphs({
  flag: asciiFlag,
  env: process.env,
  config: config.ascii,
  isTTY: !!process.stdout.isTTY,
  platform: process.platform,
}))

// Spawn the TUI's private ephemeral daemon BEFORE first render. The daemon is
// the sole refresh-loop runner / flushDisk + cache writer; the TUI is a thin
// WS-RPC client of it. If the spawn/handshake fails within ~3s, attachOrSpawn
// resolves DEGRADED (baseUrl=null) and the TUI runs its in-process loops behind
// `if (mode === 'degraded')`. Never blocks the user.
// The daemon loads config (incl. interval) from disk itself; nothing is
// forwarded on the wire here.
const daemon = await attachOrSpawn()
const mode = daemon.kind === 'spawned' ? 'connected' : 'degraded'

const { bootstrapInk } = await import('./bootstrap-ink')
await bootstrapInk({ interval, config, daemon, mode })
