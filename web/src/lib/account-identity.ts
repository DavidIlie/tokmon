import { accountIdentityText, type WebAccount } from '@shared'

/**
 * The account display label (no provider prefix). Single-sourced in
 * usage-semantics so the web dashboard, the TUI, and the daemon all resolve the
 * same title/subtitle-first identity; re-exported here as the web entry point.
 */
export { accountIdentityText }

export function scopedAccountIdentityText(account: WebAccount, providerName: string): string {
  const identity = accountIdentityText(account, providerName)
  return identity.toLocaleLowerCase() === providerName.toLocaleLowerCase()
    ? providerName
    : `${providerName} · ${identity}`
}
