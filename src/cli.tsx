import { EventEmitter } from 'node:events'

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message || error.name
  if (typeof error === 'string') return error
  try { return JSON.stringify(error) ?? String(error) } catch { return String(error) }
}

function reportFatalError(context: string, error: unknown): void {
  console.error(`tokmon: ${context}: ${describeError(error)}`)
  if (error instanceof Error && error.stack && error.stack !== error.message) console.error(error.stack)
  process.exitCode = 1
}

EventEmitter.defaultMaxListeners = 100

const emitWarning = process.emitWarning.bind(process)
process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
  const msg = typeof warning === 'string' ? warning : warning?.message
  if (typeof msg === 'string' && /SQLite is an experimental feature/i.test(msg)) return
  return (emitWarning as (...a: unknown[]) => void)(warning, ...rest)
}) as typeof process.emitWarning

const args = process.argv.slice(2)

const subcommand = args[0]?.toLowerCase()

function parsePort(value: string | undefined): number {
  const port = value === undefined ? Number.NaN : Number(value)
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error('--port must be an integer between 0 and 65535')
  }
  return port
}

function validateServeArgs(serveArgs: string[]): void {
  for (let i = 0; i < serveArgs.length; i++) {
    const arg = serveArgs[i]
    if (arg === '--port' || arg === '-p') parsePort(serveArgs[++i])
    else if (arg.startsWith('--port=')) parsePort(arg.slice('--port='.length))
  }
}

async function main(): Promise<void> {
  if (subcommand === 'config') {
    const { runConfigCommand } = await import('./cli-config-command')
    try {
      const output = await runConfigCommand(args.slice(1))
      process.stdout.write(output)
      process.exitCode ??= 0
    } catch (error) {
      const message = describeError(error)
      if (args.includes('--json')) process.stderr.write(JSON.stringify({ error: message }) + '\n')
      else process.stderr.write(`tokmon config: ${message}\nRun tokmon config --help for usage.\n`)
      process.exitCode = 1
    }
    return
  }

  if (subcommand && ['usage', 'models', 'query', 'providers', 'snapshot'].includes(subcommand)) {
    const { runQueryCommand } = await import('./cli-command')
    try {
      const output = await runQueryCommand(
        subcommand as 'usage' | 'models' | 'query' | 'providers' | 'snapshot',
        args.slice(1),
      )
      process.stdout.write(output)
      process.exitCode ??= 0
    } catch (error) {
      const message = describeError(error)
      if (args.includes('--json')) process.stderr.write(JSON.stringify({ error: message }) + '\n')
      else process.stderr.write(`tokmon ${subcommand}: ${message}\nRun tokmon ${subcommand} --help for usage.\n`)
      process.exitCode = 1
    }
    return
  }

  if (subcommand === '__daemon') {
    const { runDaemon } = await import('./web/daemon')
    await runDaemon(args.slice(1), { foreground: false })
    process.exitCode ??= 0
    return
  }

  if (subcommand === 'serve' || subcommand === 'web') {
    validateServeArgs(args.slice(1))
    const { runDaemon } = await import('./web/daemon')
    await runDaemon(args.slice(1), { foreground: true })
    process.exitCode ??= 0
    return
  }

  let interval: number | undefined
  let asciiFlag: 'on' | 'off' | null = null

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--interval' || args[i] === '-i') {
      const seconds = Number(args[i + 1])
      if (!Number.isFinite(seconds) || seconds <= 0) {
        throw new Error('--interval must be a positive number of seconds')
      }
      interval = Math.max(500, seconds * 1000)
      i++
    }
    if (args[i] === '--ascii') asciiFlag = 'on'
    if (args[i] === '--no-ascii') asciiFlag = 'off'
    if (args[i] === '--help' || args[i] === '-h') {
      console.log('tokmon - Terminal usage dashboard for your AI coding tools\n')
      console.log('  Claude · Codex · Cursor · Copilot · opencode · pi · Antigravity · Gemini · Grok\n')
      console.log('Usage: tokmon [options]')
      console.log('       tokmon serve [--port <n>] [--no-open]   Launch the web dashboard\n')
      console.log('Data commands:')
      console.log('  tokmon usage [--period month] [--json]       Query usage by model')
      console.log('  tokmon providers [--json]                    Show providers and local paths')
      console.log('  tokmon snapshot [--refresh]                  Print the raw daemon snapshot')
      console.log('  tokmon config [path]                         Print the config file location')
      console.log('  Run tokmon <command> --help for all filters and examples.\n')
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
      console.log('  r / R       Refresh all data')
      console.log('  s           Settings')
      console.log('  q           Quit')
      process.exitCode = 0
      return
    }
  }

  const { loadConfig } = await import('./config')
  const { resolveGlyphs, setGlyphs } = await import('./ui/glyphs')
  const { attachOrSpawn } = await import('./client/daemon-handle')

  const config = await loadConfig()

  setGlyphs(resolveGlyphs({
    flag: asciiFlag,
    env: process.env,
    config: config.ascii,
    isTTY: !!process.stdout.isTTY,
    platform: process.platform,
  }))

  const daemon = await attachOrSpawn()
  const mode = daemon.kind === 'spawned' ? 'connected' : 'degraded'

  const { bootstrapInk } = await import('./bootstrap-ink')
  await bootstrapInk({ interval, config, daemon, mode })
}

void main().catch((error: unknown) => {
  reportFatalError('fatal error', error)
})
