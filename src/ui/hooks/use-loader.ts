import { useState, useEffect, useCallback, useRef } from 'react'

const DEBOUNCE_MS = 300
const LOADER_GRACE_MS = 600
const LOADER_MAX_MS = 8000
const LOADER_MIN_VISIBLE_MS = 700

export function useLoader({ configReady, showPicker, accountsKey, allReady, tooSmall, showSettings, accountsCount }: {
  configReady: boolean
  showPicker: boolean
  accountsKey: string
  allReady: boolean
  tooSmall: boolean
  showSettings: boolean
  accountsCount: number
}): { showLoader: boolean; resetLoader: () => void } {
  const [debouncePassed, setDebouncePassed] = useState(false)
  const [graceHold, setGraceHold] = useState(false)
  const [loaderShownAt, setLoaderShownAt] = useState<number | null>(null)
  const loaderDone = useRef(false)
  const [loaderDoneState, setLoaderDoneFlag] = useState(false)
  const setLoaderDone = useCallback((v: boolean) => {
    loaderDone.current = v
    setLoaderDoneFlag(v)
  }, [])
  const prevShowPicker = useRef(false)

  const resetLoader = useCallback(() => {
    setLoaderDone(false)
    setDebouncePassed(false)
    setGraceHold(false)
    setLoaderShownAt(null)
  }, [setLoaderDone])

  const minVisibleHold = loaderShownAt !== null && Date.now() - loaderShownAt < LOADER_MIN_VISIBLE_MS
  const showLoader = configReady && !showPicker && !showSettings && !tooSmall
    && accountsCount > 0 && (!allReady || graceHold || minVisibleHold)
    && (debouncePassed || loaderShownAt !== null) && !loaderDoneState

  useEffect(() => {
    const wasPicker = prevShowPicker.current
    prevShowPicker.current = showPicker
    if (wasPicker && !showPicker) resetLoader()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showPicker])

  useEffect(() => {
    if (showLoader && loaderShownAt === null) setLoaderShownAt(Date.now())
  }, [showLoader, loaderShownAt])

  useEffect(() => {
    if (!configReady || showPicker || accountsCount === 0) return
    if (allReady || loaderDone.current) return
    const debounce = setTimeout(() => setDebouncePassed(true), DEBOUNCE_MS)
    const deadline = setTimeout(() => { setLoaderDone(true); setDebouncePassed(false) }, LOADER_MAX_MS)
    return () => { clearTimeout(debounce); clearTimeout(deadline) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configReady, showPicker, accountsKey])

  useEffect(() => {
    if (!allReady || loaderDone.current) return
    if (loaderShownAt === null) { setLoaderDone(true); return }
    setGraceHold(true)
    const minRemaining = Math.max(0, LOADER_MIN_VISIBLE_MS - (Date.now() - loaderShownAt))
    const hold = Math.max(LOADER_GRACE_MS, minRemaining)
    const t = setTimeout(() => { setLoaderDone(true); setGraceHold(false) }, hold)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allReady, loaderShownAt])

  return { showLoader, resetLoader }
}
