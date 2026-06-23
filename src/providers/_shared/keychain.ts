import { execFile as execFileCb } from 'node:child_process'
import { promisify } from 'node:util'

const execFile = promisify(execFileCb)
const GO_KEYRING_PREFIX = 'go-keyring-base64:'

export async function readMacKeychainRaw(service: string): Promise<string | null> {
  if (process.platform !== 'darwin') return null
  try {
    const { stdout } = await execFile('security', [
      'find-generic-password', '-s', service, '-w',
    ], { timeout: 5000 })
    const raw = stdout.trim()
    return raw || null
  } catch {
    return null
  }
}

export function unwrapGoKeyringBase64(raw: string): string {
  if (!raw.startsWith(GO_KEYRING_PREFIX)) return raw
  return Buffer.from(raw.slice(GO_KEYRING_PREFIX.length), 'base64').toString('utf-8')
}
