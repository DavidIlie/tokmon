import { readJson } from './http'
import type { PeakStatus } from './web/contract'

export type { PeakStatus }

interface PromoClockResponse {
  status?: string
  isPeak?: boolean
  isOffPeak?: boolean
  isWeekend?: boolean
  label?: string
  minutesUntilChange?: number
}

/** Anthropic peak / off-peak pricing clock (promoclock.co). Global, not per-account. */
export async function fetchPeak(): Promise<PeakStatus | null> {
  try {
    const res = await fetch('https://promoclock.co/api/status', {
      headers: { 'Accept': 'application/json', 'User-Agent': 'tokmon' },
      signal: AbortSignal.timeout(3000),
    })
    if (!res.ok) return null
    const data = await readJson<PromoClockResponse>(res)
    if (!data) return null

    let state: PeakStatus['state']
    if (data.isPeak === true || data.status === 'peak') state = 'peak'
    else if (data.isWeekend === true || data.status === 'weekend') state = 'weekend'
    else if (data.isOffPeak === true || data.status === 'off_peak' || data.status === 'off-peak') state = 'off-peak'
    else return null

    return {
      state,
      label: state === 'peak' ? 'Peak' : state === 'weekend' ? 'Weekend' : 'Off-Peak',
      minutesUntilChange: typeof data.minutesUntilChange === 'number' ? data.minutesUntilChange : null,
    }
  } catch {
    return null
  }
}
