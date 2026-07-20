import path from 'node:path'

export type DesktopChannel = 'release' | 'dev'

export interface DesktopIdentity {
  channel: DesktopChannel
  instance: string
  appName: string
  userDataDirectoryName: string
}

const SAFE_INSTANCE = /[^a-zA-Z0-9._-]+/g

export function resolveDesktopChannel(
  value: string | undefined,
  packaged: boolean,
): DesktopChannel {
  if (value === 'release' || value === 'dev') return value
  return packaged ? 'release' : 'dev'
}

export function normalizeDevInstance(value: string | undefined): string {
  const normalized = value?.trim().replace(SAFE_INSTANCE, '-').replace(/^-+|-+$/g, '')
  return normalized || 'dev'
}

export function desktopIdentity(
  channel: DesktopChannel,
  instanceValue?: string,
): DesktopIdentity {
  const instance = channel === 'dev' ? normalizeDevInstance(instanceValue) : 'release'
  if (channel === 'release') {
    return { channel, instance, appName: 'Tokmon', userDataDirectoryName: 'Tokmon' }
  }
  const suffix = instance === 'dev' ? '' : ` · ${instance}`
  return {
    channel,
    instance,
    appName: `Tokmon Dev${suffix}`,
    userDataDirectoryName: `Tokmon Dev${suffix}`,
  }
}

export function desktopUserDataPath(appDataPath: string, identity: DesktopIdentity): string {
  return path.join(appDataPath, identity.userDataDirectoryName)
}
