import { useState, useEffect } from 'react'
import { useStdout } from 'ink'

export interface TermSize { cols: number; rows: number; resizing: boolean; live: { cols: number; rows: number } }
export function useTerminalSize(settleMs = 90): TermSize {
  const { stdout } = useStdout()
  const read = () => ({ cols: stdout?.columns || 80, rows: stdout?.rows || 24 })
  const [size, setSize] = useState(read)
  const [live, setLive] = useState(read)
  const [resizing, setResizing] = useState(false)
  useEffect(() => {
    if (!stdout) return
    let t: ReturnType<typeof setTimeout> | undefined
    const now = () => ({ cols: stdout.columns || 80, rows: stdout.rows || 24 })
    const settle = () => { setSize(now()); setResizing(false) }
    const onResize = () => {
      setLive(now())
      setResizing(true)
      if (t) clearTimeout(t)
      t = setTimeout(settle, settleMs)
    }
    stdout.on('resize', onResize)
    return () => { if (t) clearTimeout(t); stdout.off('resize', onResize) }
  }, [stdout, settleMs])
  return { cols: size.cols, rows: size.rows, resizing, live }
}
