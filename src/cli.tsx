import { render } from 'ink'
import { loadConfig } from './config'
import { App } from './app'

const args = process.argv.slice(2)
let interval: number | undefined

for (let i = 0; i < args.length; i++) {
  if ((args[i] === '--interval' || args[i] === '-i') && args[i + 1]) {
    interval = Math.max(500, Number(args[i + 1]) * 1000)
    i++
  }
  if (args[i] === '--help' || args[i] === '-h') {
    console.log('tokmon - Terminal dashboard for Claude Code usage\n')
    console.log('Usage: tokmon [options]\n')
    console.log('Options:')
    console.log('  -i, --interval <seconds>  Refresh interval (default: from config or 2)')
    console.log('  -h, --help                Show this help\n')
    console.log('Keybindings:')
    console.log('  Tab / ←→    Switch views')
    console.log('  ↑↓          Scroll table')
    console.log('  1-2         Jump to view')
    console.log('  s           Settings')
    console.log('  q           Quit')
    process.exit(0)
  }
}

const config = await loadConfig()
if (config.clearScreen && process.stdout.isTTY) {
  process.stdout.write('\x1B[2J\x1B[H')
}

const { waitUntilExit } = render(<App interval={interval} />)
await waitUntilExit()
