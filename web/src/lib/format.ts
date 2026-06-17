export function fmtCost(n: number, opts: { sign?: boolean } = {}): string {
  if (!Number.isFinite(n)) return '$0.00'
  const sign = opts.sign && n > 0 ? '+' : ''
  const abs = Math.abs(n)
  if (abs >= 100_000) return `${sign}$${(n / 1000).toFixed(0)}k`
  if (abs >= 10_000) return `${sign}$${(n / 1000).toFixed(1)}k`
  if (abs >= 1) return `${sign}$${n.toFixed(2)}`
  if (abs >= 0.01) return `${sign}$${n.toFixed(3)}`
  if (abs === 0) return '$0.00'
  return `${sign}$${n.toFixed(4)}`
}

export function fmtCostAxis(n: number): string {
  if (!Number.isFinite(n)) return '$0'
  const a = Math.abs(n)
  if (a >= 1e6) return `$${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`
  if (a >= 1000) return `$${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`
  if (a >= 1) return `$${Math.round(n)}`
  if (a === 0) return '$0'
  return `$${n.toFixed(2)}`
}

export function fmtTokens(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '0'
  const abs = Math.abs(n)
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}k`
  return String(Math.round(n))
}

export function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return '0'
  return Math.round(n).toLocaleString('en-US')
}

export function fmtPct(n: number, digits = 0): string {
  if (!Number.isFinite(n)) return '0%'
  return `${(n * 100).toFixed(digits)}%`
}

export function fmtAgo(ms: number, now: number): string {
  const s = Math.max(0, Math.round((now - ms) / 1000))
  if (s < 2) return 'just now'
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  return `${h}h ago`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export function fmtDayLabel(label: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(label)
  if (m) return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}`
  const mm = /^(\d{4})-(\d{2})$/.exec(label)
  if (mm) return `${MONTHS[Number(mm[2]) - 1]} ${m?.[1] ?? mm[1]}`
  return label
}
