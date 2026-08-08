import { useEffect, useState } from 'react'

/**
 * A coarse ticking clock for relative timestamps. Countdowns rendered from a
 * render-time Date.now() freeze between snapshots, which reads as a stalled
 * dashboard; a 30s tick keeps "resets in 12m" honest without re-render churn.
 */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}
