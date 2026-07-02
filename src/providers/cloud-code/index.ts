import { resetIn } from '../../format'
import type { Metric } from '../types'
import { sqliteStatusMessage, type SqliteStatus } from '../cursor/sqlite'
import type { CloudCodeBucket } from './api'

export { readAntigravityOAuthToken, type CloudCodeToken } from './auth'
export { fetchCloudCodeQuota, type CloudCodeBucket, type CloudCodeResult } from './api'

function normalizeLabel(label: string): string {
  return label.replace(/\s*\([^)]*\)\s*$/, '').trim()
}

function poolLabel(label: string, fullGeminiLabels = false): string {
  const lower = normalizeLabel(label).toLowerCase()
  // Claude is matched EXPLICITLY (Antigravity pools Claude models too) -- never
  // as a fallback, or non-pro/flash Gemini models render as a bogus "Claude"
  // quota row on the Gemini card.
  if (lower.includes('claude')) return 'Claude'
  if (lower.includes('gemini') && lower.includes('pro')) return fullGeminiLabels ? 'Gemini Pro' : 'Pro'
  if (lower.includes('gemini') && lower.includes('flash')) return fullGeminiLabels ? 'Gemini Flash' : 'Flash'
  if (lower.includes('gemini')) return 'Gemini'
  return normalizeLabel(label) || 'Other'
}

function sortKey(label: string): string {
  const lower = label.toLowerCase()
  if (lower === 'pro') return `0a_${label}`
  if (lower === 'flash') return `0b_${label}`
  if (lower === 'gemini') return `0c_${label}`
  if (lower === 'claude') return `1b_${label}`
  if (lower.includes('gemini') && lower.includes('pro')) return `0a_${label}`
  if (lower.includes('gemini')) return `0b_${label}`
  if (lower.includes('claude') && lower.includes('opus')) return `1a_${label}`
  if (lower.includes('claude')) return `1b_${label}`
  return `2_${label}`
}

export function cloudCodeBucketsToMetrics(buckets: CloudCodeBucket[], options: { fullGeminiLabels?: boolean } = {}): Metric[] {
  const pooled = new Map<string, CloudCodeBucket>()
  for (const bucket of buckets) {
    if (!Number.isFinite(bucket.remainingFraction)) continue
    const label = poolLabel(bucket.modelId, options.fullGeminiLabels === true)
    const existing = pooled.get(label)
    if (!existing || bucket.remainingFraction < existing.remainingFraction) {
      pooled.set(label, { ...bucket, modelId: label })
    }
  }
  return [...pooled.values()]
    .sort((a, b) => sortKey(a.modelId).localeCompare(sortKey(b.modelId)))
    .map((bucket, i) => {
      const clamped = Math.max(0, Math.min(1, bucket.remainingFraction))
      return {
        label: bucket.modelId,
        used: Math.round((1 - clamped) * 100),
        limit: 100,
        format: { kind: 'percent' },
        resetsAt: bucket.resetTime ? resetIn(bucket.resetTime) : null,
        primary: i === 0,
      }
    })
}

export function cloudCodeSqliteError(status: SqliteStatus): string {
  return status === 'ok' ? 'Not signed in — open Antigravity' : sqliteStatusMessage(status).replace(/Cursor/g, 'Antigravity')
}
