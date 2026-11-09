import { homedir } from 'node:os'
import { join } from 'node:path'

// Checked 2026-11-09: https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/utils/paths.ts
// GEMINI_CLI_HOME replaces the OS home, not the .gemini directory; no tilde expansion.
export function geminiDir(homeDir?: string): string {
  return join(homeDir ?? (process.env.GEMINI_CLI_HOME || homedir()), '.gemini')
}
