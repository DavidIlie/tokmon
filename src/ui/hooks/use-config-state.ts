import { useCallback, useEffect, useRef, useState } from 'react'
import {
  DEFAULTS,
  loadConfig,
  normalizeConfig,
  saveConfigSync,
  type Config,
} from '../../config'
import { describeConfigUpdateFailure, type PendingConfigUpdate } from '../../config-sync'
import type { UseDaemon } from '../../client/use-daemon'
import { applyStartup } from '../../app.logic'

/**
 * Owns optimistic config state and the connected daemon's single serialized
 * write drain. Stream echoes cannot overwrite newer local edits while a write
 * is pending; conflicts replace the draft with the daemon's authoritative state.
 */
export function useConfigState({
  initialConfig,
  cliInterval,
  connected,
  daemon,
}: {
  initialConfig?: Config
  cliInterval?: number
  connected: boolean
  daemon: Pick<UseDaemon, 'config' | 'setConfig'>
}): {
  config: Config | null
  configSaveError: string | null
  updateConfig: (fn: (previous: Config) => Config) => void
} {
  const [config, setConfig] = useState<Config | null>(() =>
    initialConfig ? applyStartup(initialConfig, cliInterval) : null,
  )
  const [configSaveError, setConfigSaveError] = useState<string | null>(null)
  const configRef = useRef(config)
  const pendingRef = useRef<PendingConfigUpdate | null>(null)
  const queuedRef = useRef<Config | null>(null)
  configRef.current = config

  useEffect(() => {
    if (initialConfig) return
    void loadConfig().then(next => setConfig(applyStartup(next, cliInterval)))
  }, [initialConfig, cliInterval])

  const drain = useCallback(async (first: Config, expectedRevision: number): Promise<void> => {
    let candidate = first
    let revision = expectedRevision
    try {
      for (;;) {
        const outgoing = { ...candidate, revision }
        pendingRef.current = { config: outgoing, expectedRevision: revision }
        const saved = await daemon.setConfig(outgoing, revision)
        const queued = queuedRef.current
        queuedRef.current = null
        if (queued) {
          candidate = queued
          revision = saved.config.revision
          continue
        }
        pendingRef.current = null
        configRef.current = saved.config
        setConfig(saved.config)
        setConfigSaveError(null)
        return
      }
    } catch (cause) {
      pendingRef.current = null
      queuedRef.current = null
      const failure = describeConfigUpdateFailure(cause)
      if (failure.conflictState) {
        configRef.current = failure.conflictState.config
        setConfig(failure.conflictState.config)
      }
      setConfigSaveError(failure.message)
    }
  }, [daemon])

  const updateConfig = useCallback((fn: (previous: Config) => Config): void => {
    const current = configRef.current ?? DEFAULTS
    const next = normalizeConfig({ ...fn(current), revision: current.revision })
    configRef.current = next
    setConfig(next)
    setConfigSaveError(null)
    if (connected) {
      if (pendingRef.current) queuedRef.current = next
      else void drain(next, current.revision)
      return
    }
    try {
      saveConfigSync(next)
    } catch (cause) {
      setConfigSaveError(cause instanceof Error ? cause.message : 'config could not be saved')
    }
  }, [connected, drain])

  const daemonConfig = daemon.config?.config
  useEffect(() => {
    if (!connected || !daemonConfig || pendingRef.current) return
    if (daemonConfig.revision < (configRef.current?.revision ?? 0)) return
    configRef.current = daemonConfig
    setConfig(daemonConfig)
  }, [connected, daemonConfig])

  return { config, configSaveError, updateConfig }
}
