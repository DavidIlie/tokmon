import { render } from 'ink'
import { MouseProvider } from '@zenobius/ink-mouse'
import { App } from './app'
import type { Config } from './config'
import type { DaemonHandle } from './client/daemon-handle'

interface BootstrapInputs {
  interval?: number
  config: Config
  daemon: DaemonHandle
  mode: 'connected' | 'degraded'
}

function enterAltScreen(): void { process.stdout.write('\x1B[?1049h\x1B[H') }
function leaveAltScreen(): void { try { process.stdout.write('\x1B[?1049l') } catch {} }
function setupInputModes(): void {
  process.stdout.write('\x1B[?2004h\x1B[?1004l')
}
function restoreInputModes(): void {
  try { process.stdout.write('\x1B[?2004l') } catch {}
}

export async function bootstrapInk({ interval, config, daemon, mode }: BootstrapInputs): Promise<void> {
  const isTTY = process.stdout.isTTY === true
  const altScreen = config.clearScreen && isTTY
  if (altScreen) enterAltScreen()
  if (isTTY) setupInputModes()
  process.once('exit', () => {
    if (isTTY) restoreInputModes()
    if (altScreen) leaveAltScreen()
  })

  const { waitUntilExit } = render(
    <MouseProvider>
      <App
        interval={interval}
        initialConfig={config}
        baseUrl={daemon.baseUrl}
        wsToken={daemon.wsToken}
        mode={mode}
      />
    </MouseProvider>,
  )

  await waitUntilExit()
  // The open WS keeps the event loop alive for seconds; exit promptly instead of waiting for teardown.
  daemon.stop()
  if (isTTY) restoreInputModes()
  if (altScreen) leaveAltScreen()
  process.exit(typeof process.exitCode === 'number' ? process.exitCode : 0)
}
