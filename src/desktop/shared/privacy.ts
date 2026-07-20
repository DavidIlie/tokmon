import { redactEmail, type WebAccount } from '../../web/contract'
export { matchesPrivacyShortcut } from '../../privacy-shortcut'

/**
 * Email-only desktop identity, with canonical daemon ordinals in privacy mode.
 *
 * DELIBERATE DIVERGENCE — do not "consolidate" this onto the shared title-first
 * resolver (`accountIdentityText` in usage-semantics). The menu-bar surface is
 * email-first by design: a registered title never decorates a discovered email,
 * and email wins over a display name. This is locked by renderer/privacy.test.ts.
 * Everything else (web dashboard, TUI) uses the shared title/subtitle resolver.
 */
export function accountIdentity(account: WebAccount, privacy: boolean): string {
  const email = account.email?.trim() ?? ''
  if (privacy) {
    if (account.identity?.redacted) return account.identity.accessibleLabel
    return email ? redactEmail(email) : 'Account'
  }
  return email
    || account.displayName?.trim()
    || account.identity?.title.trim()
    || account.name.trim()
    || account.id
}
