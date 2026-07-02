import { useCallback, useRef } from 'react'
import { sanitizeTyped } from '../../config'

const PASTE_START = '\x1b[200~'
const PASTE_END = '\x1b[201~'
const PASTE_MAX = 1 << 20

export function usePaste(onInsert: (text: string) => void): {
  handlePasteData: (chunk: Buffer | string) => boolean
  isPasteInput: (input: string) => boolean
} {
  const pasteBufRef = useRef<string | null>(null)
  const pasteCarryRef = useRef<string>('')
  const insertPasteRef = useRef<(text: string) => void>(() => {})
  insertPasteRef.current = onInsert

  const handlePasteData = useCallback((chunk: Buffer | string): boolean => {
    const s = typeof chunk === 'string' ? chunk : chunk.toString('utf8')

    if (pasteBufRef.current !== null) {
      const combined = pasteBufRef.current + s
      const end = combined.indexOf(PASTE_END)
      if (end === -1) {
        if (combined.length >= PASTE_MAX) {
          const clean = sanitizeTyped(combined)
          pasteBufRef.current = null
          if (clean) insertPasteRef.current(clean)
          return true
        }
        pasteBufRef.current = combined
        return true
      }
      const clean = sanitizeTyped(combined.slice(0, end))
      pasteBufRef.current = null
      if (clean) insertPasteRef.current(clean)
      return end + PASTE_END.length >= combined.length
    }

    const combined = pasteCarryRef.current + s
    const start = combined.indexOf(PASTE_START)
    if (start === -1) {
      const keep = Math.min(combined.length, PASTE_START.length - 1)
      pasteCarryRef.current = combined.slice(combined.length - keep)
      return false
    }
    pasteCarryRef.current = ''
    const rest = combined.slice(start + PASTE_START.length)
    const end = rest.indexOf(PASTE_END)
    if (end === -1) {
      pasteBufRef.current = rest
      return true
    }
    const clean = sanitizeTyped(rest.slice(0, end))
    if (clean) insertPasteRef.current(clean)
    return true
  }, [])

  const isPasteInput = useCallback((input: string): boolean => {
    if (pasteBufRef.current !== null) return true
    return input.includes('[200~') || input.includes('[201~')
  }, [])

  return { handlePasteData, isPasteInput }
}
