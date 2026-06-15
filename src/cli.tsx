import { EventEmitter } from 'node:events'
import { render } from 'ink'
import { MouseProvider } from '@zenobius/ink-mouse'
import { loadConfig } from './config'
import { flushDisk } from './providers/usage-core'
import { resolveGlyphs, setGlyphs } from './glyphs'
import { App } from './app'

// A long-running dashboard must never die from a stray background rejection (a
// best-effort billing/usage poll, a detached config save). Keep it alive.
process.on('unhandledRejection', () => {})

// ink-mouse routes every ClickableBox through one shared EventEmitter; the
// dashboard mounts well over 10 clickable cells (tabs, focus chips, provider
// bars, table rows), so Node's default 10-listener cap fires a one-time
// MaxListenersExceededWarning that prints over the first rendered frame. These
// listeners are intentional and bounded by the UI, not a leak — lift the cap.
EventEmitter.defaultMaxListeners = 100

// node:sqlite (the Cursor reader on Node 24) emits an ExperimentalWarning on
// first use; swallow only that one so it can't corrupt the rendered frame.
const emitWarning = process.emitWarning.bind(process)
process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
  const msg = typeof warning === 'string' ? warning : warning?.message
  if (typeof msg === 'string' && /SQLite is an experimental feature/i.test(msg)) return
  return (emitWarning as (...a: unknown[]) => void)(warning, ...rest)
}) as typeof process.emitWarning

const args = process.argv.slice(2)
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
    console.log('Usage: tokmon [options]\n')
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
    console.log('  s           Settings')
    console.log('  q           Quit')
    process.exit(0)
  }
}

const config = await loadConfig()

// Alternate screen buffer (like htop / vim / bpytop): render the dashboard
// full-screen, then restore the user's previous terminal contents on exit
// rather than leaving the last frame in scrollback. Gated on the clearScreen
// setting + a real TTY. The 'exit' listener fires on every termination path
// (q, Ctrl-C via Ink, process.exit, uncaught errors) so we never strand the
// terminal in the alt buffer.
const altScreen = config.clearScreen && process.stdout.isTTY === true
const leaveAltScreen = () => { try { process.stdout.write('\x1B[?1049l') } catch {} }
if (altScreen) {
  process.stdout.write('\x1B[?1049h\x1B[H')
  process.once('exit', leaveAltScreen)
}

setGlyphs(resolveGlyphs({
  flag: asciiFlag,
  env: process.env,
  config: config.ascii,
  isTTY: !!process.stdout.isTTY,
  platform: process.platform,
}))

const { waitUntilExit } = render(<MouseProvider><App interval={interval} initialConfig={config} /></MouseProvider>)
await waitUntilExit()

// Persist any pending parse cache before exit — the scheduled flush uses an
// unref'd 4s timer, so a quick quit on a cold first run would otherwise lose it.
await flushDisk()

if (altScreen) leaveAltScreen()
