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
  // FAST QUIT: at this point the React tree is already unmounted, which fired
  // useDaemon's effect cleanup (a fire-and-forget client.close()). The lingering
  // event-loop handles are the WS Socket(s) over the Effect runtime + the daemon
  // ChildProcess — the open WS in particular keeps the loop alive for several
  // seconds before its close handshake/idle timeout fires, so falling off the end
  // of cli.tsx (no process.exit) makes `q` feel like a ~4s+ hang.
  //
  // We don't need a graceful socket close on quit: daemon.stop() SIGTERMs the
  // child (frees the port + runs flushDisk), and the child also self-exits when
  // our stdin write-end closes on parent death (the stdin-close backstop in
  // daemon-handle.ts). So restore the terminal synchronously and exit promptly
  // rather than waiting for the WS teardown to drain the loop.
  daemon.stop()
  if (isTTY) restoreInputModes()
  if (altScreen) leaveAltScreen()
  process.exit(typeof process.exitCode === 'number' ? process.exitCode : 0)
}
