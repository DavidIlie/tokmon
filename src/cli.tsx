import { EventEmitter } from 'node:events'
import { render } from 'ink'
import { MouseProvider } from '@zenobius/ink-mouse'
import { loadConfig } from './config'
import { flushDisk } from './providers/usage-core'
import { resolveGlyphs, setGlyphs } from './glyphs'
import { App } from './app'

process.on('unhandledRejection', () => {})

EventEmitter.defaultMaxListeners = 100

const emitWarning = process.emitWarning.bind(process)
process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
  const msg = typeof warning === 'string' ? warning : warning?.message
  if (typeof msg === 'string' && /SQLite is an experimental feature/i.test(msg)) return
  return (emitWarning as (...a: unknown[]) => void)(warning, ...rest)
}) as typeof process.emitWarning

const args = process.argv.slice(2)

// Subcommands must be handled before flag parsing / Ink render. `serve` (alias
// `web`) launches the local web dashboard headlessly and owns the process.
const subcommand = args[0]?.toLowerCase()
if (subcommand === 'serve' || subcommand === 'web') {
  const { startWeb } = await import('./web/index')
  await startWeb(args.slice(1))
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
    console.log('  W           Toggle web dashboard')
    console.log('  s           Settings')
    console.log('  q           Quit')
    process.exit(0)
  }
}

const config = await loadConfig()

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

await flushDisk()

if (altScreen) leaveAltScreen()
