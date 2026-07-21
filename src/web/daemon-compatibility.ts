export type DaemonOwnerKind = 'cli' | 'desktop'

export interface DaemonOwnerIdentity {
  ownerKind?: DaemonOwnerKind
  version?: string
  protocolVersion?: number
}

export type DaemonCompatibilityDecision =
  | { action: 'attach'; reason: 'same-protocol' }
  | { action: 'retire'; reason: 'older-cli' | 'legacy-cli' }
  | {
      action: 'refuse'
      reason: 'desktop-owner' | 'newer-cli' | 'ambiguous-owner'
    }

/**
 * Decide whether a live daemon may be shared, gracefully upgraded, or left
 * alone. App versions are deliberately informational: the RPC protocol is the
 * compatibility boundary.
 */
export function classifyDaemonCompatibility(
  owner: DaemonOwnerIdentity,
  clientProtocolVersion: number,
): DaemonCompatibilityDecision {
  if (owner.protocolVersion === clientProtocolVersion) {
    return { action: 'attach', reason: 'same-protocol' }
  }
  if (owner.ownerKind === 'desktop') {
    return { action: 'refuse', reason: 'desktop-owner' }
  }
  if (owner.ownerKind === 'cli' && owner.protocolVersion !== undefined) {
    return owner.protocolVersion < clientProtocolVersion
      ? { action: 'retire', reason: 'older-cli' }
      : { action: 'refuse', reason: 'newer-cli' }
  }
  if (owner.ownerKind === undefined && owner.protocolVersion === undefined) {
    return { action: 'retire', reason: 'legacy-cli' }
  }
  return { action: 'refuse', reason: 'ambiguous-owner' }
}

export interface DaemonConflictContext {
  clientKind: DaemonOwnerKind
  clientProtocolVersion: number
  retirementFailed?: boolean
  verificationFailed?: boolean
}

export function daemonConflictMessage(
  owner: DaemonOwnerIdentity,
  context: DaemonConflictContext,
): string {
  const kind = owner.ownerKind === 'desktop'
    ? 'Tokmon Desktop'
    : owner.ownerKind === 'cli'
      ? 'Tokmon CLI background service'
      : 'Legacy Tokmon background service'
  const name = owner.version ? `${kind} ${owner.version}` : kind
  const ownerProtocol = owner.protocolVersion === undefined
    ? 'an implicit legacy protocol'
    : `protocol ${owner.protocolVersion}`
  const client = context.clientKind === 'desktop' ? 'this desktop app' : 'this CLI'
  if (context.verificationFailed) {
    return `A live lock claims ${name} using ${ownerProtocol}, but its owner proof could not be verified. It was not signalled. Quit the existing Tokmon process, remove a stale lock only after confirming it has stopped, then retry.`
  }
  if (owner.protocolVersion === context.clientProtocolVersion) {
    return `${name} claims compatible protocol ${context.clientProtocolVersion}, but its owner proof could not be verified. It was not signalled. Quit the existing Tokmon process, then retry.`
  }
  const summary = `${name} owns the background service using ${ownerProtocol}; ${client} needs protocol ${context.clientProtocolVersion}.`

  if (context.retirementFailed) {
    return `${summary} Tokmon could not stop that older CLI service safely, so it was left running. Quit the existing Tokmon CLI/background service, then retry.`
  }
  if (owner.ownerKind === 'desktop') {
    if (context.clientKind === 'desktop') {
      return owner.protocolVersion !== undefined && owner.protocolVersion < context.clientProtocolVersion
        ? `${summary} Fully quit the older Tokmon Desktop instance, install the current release, then reopen Tokmon.`
        : `${summary} This app is older than the running Tokmon Desktop instance. Reopen the newer app, or replace this installation with the current release.`
    }
    if (owner.protocolVersion !== undefined && owner.protocolVersion < context.clientProtocolVersion) {
      return `${summary} In Tokmon Desktop, open Settings → Desktop App → Check for Updates, install the update, then restart Tokmon. Alternatively, quit Tokmon Desktop before retrying the CLI.`
    }
    return `${summary} Update the CLI with \`pnpm --config.minimum-release-age=0 dlx tokmon@latest\`, or quit Tokmon Desktop before retrying this CLI.`
  }
  if (owner.ownerKind === 'cli' && owner.protocolVersion !== undefined && owner.protocolVersion > context.clientProtocolVersion) {
    return context.clientKind === 'desktop'
      ? `${summary} Update Tokmon Desktop and restart it, or stop the newer CLI background service before reopening the app.`
      : `${summary} Update the CLI with \`pnpm --config.minimum-release-age=0 dlx tokmon@latest\`, or stop the newer background service before retrying.`
  }
  return `${summary} The owner could not be identified safely and was not signalled. Quit the existing Tokmon process, then retry.`
}
