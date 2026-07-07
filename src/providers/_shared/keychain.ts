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

// Reads a service item from a specific keychain FILE (not the default search
// list). Alternate-account setups launch a CLI under an isolated HOME with its
// own login.keychain-db protected by an empty password so it can be unlocked
// without a prompt. Unlock is attempted first with the empty password; if that
// fails (password-protected or corrupt keychain) we bail out rather than let
// find-generic-password raise a UI prompt.
export async function readMacKeychainFileRaw(service: string, keychainPath: string): Promise<string | null> {
  if (process.platform !== 'darwin') return null
  try {
    await execFile('security', ['unlock-keychain', '-p', '', keychainPath], { timeout: 5000 })
    const { stdout } = await execFile('security', [
      'find-generic-password', '-s', service, '-w', keychainPath,
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
