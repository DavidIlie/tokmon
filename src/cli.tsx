import { render } from 'ink'
import { MouseProvider } from '@zenobius/ink-mouse'
import { loadConfig } from './config'
import { flushDisk } from './providers/usage-core'
import { App } from './app'

// A long-running dashboard must never die from a stray background rejection (a
// best-effort billing/usage poll, a detached config save). Keep it alive.
process.on('unhandledRejection', () => {})

const args = process.argv.slice(2)
let interval: number | undefined

for (let i = 0; i < args.length; i++) {
  if ((args[i] === '--interval' || args[i] === '-i') && args[i + 1]) {
    interval = Math.max(500, Number(args[i + 1]) * 1000)
    i++
  }
  if (args[i] === '--help' || args[i] === '-h') {
    console.log('tokmon - Terminal dashboard for Claude, Codex, and Cursor usage\n')
    console.log('Usage: tokmon [options]\n')
    console.log('Options:')
    console.log('  -i, --interval <seconds>  Refresh interval (default: from config or 2)')
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
if (config.clearScreen && process.stdout.isTTY) {
  process.stdout.write('\x1B[2J\x1B[H')
}

const { waitUntilExit } = render(<MouseProvider><App interval={interval} /></MouseProvider>)
await waitUntilExit()

// Persist any pending parse cache before exit — the scheduled flush uses an
// unref'd 4s timer, so a quick quit on a cold first run would otherwise lose it.
await flushDisk()
